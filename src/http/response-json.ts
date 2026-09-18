/** Internal transport for small JSON APIs. One attempt; callers own retry policy. */
export class ProviderProtocolError extends Error {
  constructor(message: string, readonly code: string, readonly status = 502, readonly definitive = false) {
    super(message)
    this.name = 'ProviderProtocolError'
  }
}

export interface JsonRequestOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

/** Do not let an injected transport that ignores AbortSignal strand its caller. */
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(() => {}); throw signal.reason }
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try { return await Promise.race([pending, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

export async function requestJson(url: string, init: RequestInit, options: JsonRequestOptions): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const max = options.maxResponseBytes ?? 1_000_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(max) || max <= 0) {
    throw new ProviderProtocolError('Invalid response limits', 'invalid_options', 400, true)
  }
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init.signal ? [init.signal] : [])])
  signal.throwIfAborted()
  const pending = (options.fetch ?? fetch)(url, { ...init, redirect: 'error', signal })
  // Late responses from a cancelled injected transport must not retain a socket/body.
  void pending.then(r => { if (signal.aborted) void r.body?.cancel().catch(() => {}) }, () => {})
  const response = await abortable(pending, signal)
  if (!response.ok) {
    void response.body?.cancel().catch(() => {})
    // Deliberately do not surface provider error bodies, which can reflect secrets.
    throw new ProviderProtocolError(`Provider returned HTTP ${response.status}`, 'provider_http_error',
      response.status, response.status >= 400 && response.status < 500 && response.status !== 408)
  }
  if (!response.body) throw new ProviderProtocolError('Provider returned no body', 'invalid_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > max) throw new ProviderProtocolError('Provider response exceeded its byte limit', 'response_limit')
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new ProviderProtocolError('Provider returned invalid JSON', 'invalid_response') }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
