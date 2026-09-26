import { ProviderProtocolError, record, requestJson, type JsonRequestOptions } from '../http/response-json.js'

export interface TangleMediaInput { model: string; prompt: string }
export interface TangleMediaClientOptions extends JsonRequestOptions {
  apiKey: string | (() => string | Promise<string>)
  baseUrl?: string
}
function bad(message: string): never {
  throw new ProviderProtocolError(message, 'invalid_media_request', 400, true)
}
function input(value: TangleMediaInput): TangleMediaInput {
  if (!record(value) || Object.keys(value).some(k => k !== 'model' && k !== 'prompt') ||
      typeof value.model !== 'string' || !value.model.trim() || value.model.length > 200 ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 16000) {
    bad('An explicit Router model and non-empty prompt are required')
  }
  return { model: value.model.trim(), prompt: value.prompt }
}
/**
 * Router's JSON media surfaces. Video is NOT OpenAI's multipart upload surface.
 * Never retry a create automatically: a lost response may already have incurred
 * spend. Return the actual response unchanged, not a fabricated success/cost.
 * Provider readiness, policy, pricing and funding remain Router-owned.
 */
export class TangleMediaClient {
  private readonly base: string
  private readonly options: TangleMediaClientOptions
  constructor(options: TangleMediaClientOptions) {
    const u = new URL(options.baseUrl ?? 'https://router.tangle.tools')
    if (u.username || u.password || u.search || u.hash || !['/', '/v1', '/v1/'].includes(u.pathname) ||
        !(u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) {
      bad('Use an explicit trusted Router HTTPS origin, or HTTP loopback')
    }
    this.base = `${u.origin}/v1`
    this.options = { timeoutMs: 120_000, maxResponseBytes: 32 * 1024 * 1024, ...options }
  }
  private async request(path: string, body?: TangleMediaInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    const key = typeof this.options.apiKey === 'function' ? await this.options.apiKey() : this.options.apiKey
    if (!key || /[\r\n]/.test(key)) throw new ProviderProtocolError('A Router credential is required', 'media_not_configured', 503, true)
    const raw = await requestJson(`${this.base}${path}`, {
      method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, this.options)
    if (!record(raw)) throw new ProviderProtocolError('Router returned a non-object media response', 'invalid_media_response')
    return raw
  }
  generateImage(value: TangleMediaInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request('/images/generations', input(value), signal)
  }
  createVideo(value: TangleMediaInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request('/videos', input(value), signal)
  }
  getVideo(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id)) bad('A Router-issued video job id is required')
    return this.request(`/videos/${encodeURIComponent(id)}`, undefined, signal)
  }
}
