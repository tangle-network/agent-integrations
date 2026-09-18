export type ManagedMessageTransport = 'sms' | 'imessage'
export interface InkboxNumber { id: string; number: string; smsStatus: string | null }
export interface InkboxIdentity {
  id: string
  handle: string
  organizationId: string
  status: string
  imessageEnabled: boolean
  sms: InkboxNumber | null
  imessage: InkboxNumber | null
}
export class MessagingProvisionError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'unavailable' | 'provider_rejected' | 'outcome_unknown' | 'invalid_receipt',
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Messaging provisioning: ${code}${status ? ` (HTTP ${status})` : ''}`)
    this.name = 'MessagingProvisionError'
  }
}
const BASE = 'https://inkbox.ai/api/v1'
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
const PHONE = /^\+[1-9]\d{6,14}$/
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MessagingProvisionError('invalid_receipt')
  return value as Record<string, unknown>
}
function readNumber(value: unknown): InkboxNumber | null {
  if (value == null) return null
  const row = record(value)
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.number !== 'string' || !PHONE.test(row.number)) throw new MessagingProvisionError('invalid_receipt')
  return { id: row.id, number: row.number, smsStatus: typeof row.sms_status === 'string' ? row.sms_status : null }
}
/** Project only channel identity. Mailbox, tunnel, credentials and contacts never leave this boundary. */
export function parseInkboxIdentity(value: unknown): InkboxIdentity {
  const row = record(value)
  if (typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.agent_handle !== 'string' ||
      row.agent_handle.length < 3 || row.agent_handle.length > 63 || !HANDLE.test(row.agent_handle) ||
      typeof row.organization_id !== 'string' || !row.organization_id || row.organization_id.length > 256 ||
      typeof row.status !== 'string' || !row.status || typeof row.imessage_enabled !== 'boolean') throw new MessagingProvisionError('invalid_receipt')
  return { id: row.id, handle: row.agent_handle, organizationId: row.organization_id, status: row.status,
    imessageEnabled: row.imessage_enabled, sms: readNumber(row.phone_number), imessage: readNumber(row.imessage_number) }
}
function assertHandle(value: string): void {
  if (value.length < 3 || value.length > 63 || !HANDLE.test(value)) throw new MessagingProvisionError('invalid_input')
}
function assertOperation(value: string): void {
  if (!value || value.length > 200 || !/^[a-zA-Z0-9:._-]+$/.test(value)) throw new MessagingProvisionError('invalid_input')
}
async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new MessagingProvisionError('invalid_receipt')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 1_048_576) { await reader.cancel(); throw new MessagingProvisionError('invalid_receipt') }
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch { throw new MessagingProvisionError('invalid_receipt') }
  finally { reader.releaseLock() }
}

/** Host-only administrative client; NOT a ConnectorAdapter and never an agent tool. */
export class InkboxProvisioner {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  constructor(private readonly options: { adminKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    if (!options.adminKey || options.adminKey.length > 4096 || /[^\x21-\x7e]/.test(options.adminKey)) throw new MessagingProvisionError('unavailable')
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
    this.timeoutMs = options.timeoutMs ?? 15_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) throw new MessagingProvisionError('invalid_input')
  }
  private async request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, operationId?: string, key = this.options.adminKey): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${BASE}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { 'X-API-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(operationId ? { 'Idempotency-Key': operationId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    } catch { throw new MessagingProvisionError(method === 'GET' ? 'unavailable' : 'outcome_unknown') }
    if ((method === 'GET' || method === 'DELETE') && response.status === 404) return null
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      const seconds = retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : undefined
      throw new MessagingProvisionError(method !== 'GET' && (response.status >= 500 || response.status === 408) ? 'outcome_unknown' : 'provider_rejected', response.status, seconds)
    }
    if (method === 'DELETE' && response.status === 204) return null
    return readJson(response)
  }
  async verifyAdminKey(): Promise<void> {
    const self = record(await this.request('GET', '/api-keys/self'))
    if (self.scoped_identity_id !== null || self.status !== 'active') throw new MessagingProvisionError('invalid_receipt')
  }
  async getIdentity(agentHandle: string): Promise<InkboxIdentity | null> {
    assertHandle(agentHandle)
    const value = await this.request('GET', `/identities/${encodeURIComponent(agentHandle)}`)
    if (value === null) return null
    return this.identityReceipt(value, agentHandle)
  }
  async createIdentity(agentHandle: string): Promise<InkboxIdentity> {
    assertHandle(agentHandle)
    return this.identityReceipt(await this.request('POST', '/identities', {
      agent_handle: agentHandle, imessage_enabled: false, contact_sharing_enabled: false,
      mailbox: { sending_domain: null },
    }), agentHandle)
  }
  async claimIMessage(agentHandle: string, operationId: string): Promise<InkboxIdentity> {
    assertHandle(agentHandle); assertOperation(operationId)
    return this.identityReceipt(await this.request('PATCH', `/identities/${encodeURIComponent(agentHandle)}`,
      { imessage_enabled: true, claim_imessage_number: true }, operationId), agentHandle)
  }
  async provisionSms(agentHandle: string, state?: string): Promise<InkboxNumber> {
    assertHandle(agentHandle)
    if (state !== undefined && !/^[A-Z]{2}$/.test(state)) throw new MessagingProvisionError('invalid_input')
    const result = readNumber(await this.request('POST', '/phone/numbers', {
      agent_handle: agentHandle, type: 'local', incoming_call_action: 'auto_reject', ...(state ? { state } : {}),
    }))
    if (!result) throw new MessagingProvisionError('invalid_receipt')
    return result
  }
  /** Encrypt before any other work. A lost response cannot be repaired by blindly minting another key. */
  async mintIdentityKey(identityId: string, label: string): Promise<{ key: string; keyId: string }> {
    if (!UUID.test(identityId) || !label.trim() || label.length > 255) throw new MessagingProvisionError('invalid_input')
    const result = record(await this.request('POST', '/api-keys', { label, scoped_identity_id: identityId }))
    const meta = record(result.record)
    if (meta.scoped_identity_id !== identityId || typeof result.api_key !== 'string' || !result.api_key || result.api_key.length > 4096 ||
      /[^\x21-\x7e]/.test(result.api_key) || typeof meta.id !== 'string' || !meta.id) throw new MessagingProvisionError('invalid_receipt')
    // Only a successful receipt is returned. The host journals this call before sending it.
    return { key: result.api_key, keyId: meta.id }
  }
  /** Safe read after the once-shown key is durable in the host vault. */
  async verifyIdentityKey(key: string, identityId: string, keyId: string): Promise<void> {
    if (!UUID.test(identityId) || !key || /[^\x21-\x7e]/.test(key) || key.length > 4096 || !keyId) throw new MessagingProvisionError('invalid_input')
    const self = record(await this.request('GET', '/api-keys/self', undefined, undefined, key))
    if (self.scoped_identity_id !== identityId || self.id !== keyId || self.status !== 'active') throw new MessagingProvisionError('invalid_receipt')
  }
  /** The host must authorize the recorded handle. Dedicated iMessage line release is not attested by this response. */
  async deleteIdentity(agentHandle: string): Promise<void> {
    assertHandle(agentHandle)
    await this.request('DELETE', `/identities/${encodeURIComponent(agentHandle)}`)
  }
  private identityReceipt(value: unknown, expectedHandle: string): InkboxIdentity {
    const identity = parseInkboxIdentity(value)
    if (identity.handle !== expectedHandle) throw new MessagingProvisionError('invalid_receipt')
    return identity
  }
}
