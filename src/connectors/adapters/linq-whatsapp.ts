import { declarativeRestConnector } from './declarative-rest.js'
import { type ConnectorAdapter, CredentialsExpired, ProviderRateLimited } from '../types.js'
import { ProviderProtocolError, retryAfterMs } from '../../http/response-json.js'
import { linqWhatsappAttachmentUrl } from '../../linq-whatsapp-attachment-url.js'

const id = { type: 'string', minLength: 1, maxLength: 256 }
const page = { cursor: id, limit: { type: 'integer', minimum: 1, maximum: 100 } }
const MAX_ATTACHMENT_BYTES = 16_000_000

async function downloadAttachment(url: string, key: string, sourceId: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${key}` },
    redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => {})
    if (response.status === 401) throw new CredentialsExpired('Linq WhatsApp rejected the API key', sourceId)
    if (response.status === 409) {
      throw new ProviderProtocolError('Linq WhatsApp attachment capture is pending', 'attachment_pending', 409)
    }
    if (response.status === 429) throw new ProviderRateLimited('Linq WhatsApp attachment rate limit (429)', sourceId,
      { status: 429, retryAfterMs: retryAfterMs(response.headers.get('retry-after')) })
    throw new ProviderProtocolError(`Linq WhatsApp attachment download returned HTTP ${response.status}`, 'provider_http_error', response.status,
      response.status >= 400 && response.status < 500 && response.status !== 408)
  }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_ATTACHMENT_BYTES)) {
    void response.body?.cancel().catch(() => {})
    throw new ProviderProtocolError('Linq WhatsApp attachment exceeded the byte limit', 'response_limit')
  }
  if (!response.body) throw new ProviderProtocolError('Linq WhatsApp attachment returned no bytes', 'invalid_response')
  const contentType = response.headers.get('content-type')
  if (!contentType || contentType.length > 200 || /[\u0000-\u001f\u007f]/.test(contentType)) {
    void response.body.cancel().catch(() => {})
    throw new ProviderProtocolError('Linq WhatsApp attachment returned an invalid media type', 'invalid_response')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_ATTACHMENT_BYTES) throw new ProviderProtocolError('Linq WhatsApp attachment exceeded the byte limit', 'response_limit')
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  if (size === 0) throw new ProviderProtocolError('Linq WhatsApp attachment returned no bytes', 'invalid_response')
  return { contentType, size, contentBase64: Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size).toString('base64') }
}

/** WhatsApp is a separate Linq service and credential, not a transport flag on v3. */
const base = declarativeRestConnector({
  kind: 'linq-whatsapp', displayName: 'Linq WhatsApp', category: 'comms',
  description: 'Use an existing WhatsApp Business identity. Reads expose current window, template and delivery state; sends acknowledge acceptance only.',
  auth: { kind: 'api-key', hint: 'The exact brand-scoped WhatsApp key from Linq Embedded Signup. Keep the issued test/live prefix unchanged.' },
  baseUrl: 'https://whatsapp.messages.api.linqapp.com/v1',
  defaultConsistencyModel: 'advisory', credentialsExpiredStatuses: [401],
  test: { method: 'GET', path: '/phone_numbers' },
  capabilities: [
    { name: 'numbers.list', class: 'read', description: 'Read existing registered sending numbers. Does not acquire a number.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/phone_numbers' } },
    { name: 'chats.list', class: 'read', description: 'Find the existing one-to-one conversation and its pinned sending number.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/chats', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'chats.get', class: 'read', description: 'Read the actual customer, sender and current free-form messaging window.',
      parameters: { type: 'object', properties: { chat_id: id }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}' } },
    { name: 'events.list', class: 'read', description: 'Read the account event log. Keep its opaque cursor separate from chat sequence numbers.',
      parameters: { type: 'object', properties: page },
      request: { method: 'GET', path: '/event_log', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'chats.events', class: 'read', description: 'Read canonical messages and delivery receipts in the selected chat.',
      parameters: { type: 'object', properties: { chat_id: id, ...page }, required: ['chat_id'] },
      request: { method: 'GET', path: '/chats/{chat_id}/events', query: { cursor: '{cursor}', limit: '{limit}' } } },
    { name: 'templates.list', class: 'read', description: 'Read approved templates and their exact send_schema; no template is inferred or substituted.',
      parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/templates' } },
    { name: 'messages.reply', class: 'mutation', cas: 'native-idempotency', externalEffect: true,
      description: 'Reply in the existing chat without changing its sender or recipient. Free-form text requires an open customer window; a refusal does not authorize template substitution.',
      parameters: { type: 'object', properties: { chat_id: id, text: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['chat_id', 'text'] },
      request: { method: 'POST', path: '/chats/{chat_id}/messages', headers: { 'Idempotency-Key': '{requestKey}' },
        body: { parts: [{ type: 'text', body: '{text}' }] } } },
  ],
})

export const linqWhatsappConnector: ConnectorAdapter = {
  ...base,
  manifest: { ...base.manifest, capabilities: [...base.manifest.capabilities,
    { name: 'attachments.content', class: 'read', description: 'Download retained incoming media bytes from an authenticated Linq attachment URL. The host must store the bytes before passing media to an agent. Maximum 16 MB.',
      parameters: { type: 'object', properties: { url: { type: 'string', format: 'uri', minLength: 1, maxLength: 2048 } }, required: ['url'] } },
  ] },
  async executeRead(inv) {
    if (inv.capabilityName !== 'attachments.content') return base.executeRead!(inv)
    const url = linqWhatsappAttachmentUrl(inv.args.url)
    if (!url) throw new Error('Linq WhatsApp requires an exact attachment URL from an incoming media part')
    if (inv.source.credentials.kind !== 'api-key' || !inv.source.credentials.apiKey ||
        /[\u0000-\u0020\u007f]/.test(inv.source.credentials.apiKey)) {
      throw new Error('Linq WhatsApp requires the connected brand API key')
    }
    return { data: await downloadAttachment(url, inv.source.credentials.apiKey, inv.source.id), fetchedAt: Date.now() }
  },
  async executeMutation(inv) {
    if (!inv.idempotencyKey || inv.idempotencyKey.length > 255 || !/^[\x21-\x7e]+$/.test(inv.idempotencyKey)) {
      throw new Error('Linq WhatsApp requires a bounded stable operation key')
    }
    // The execution identity is host-owned, never a model-authored header.
    return base.executeMutation!({ ...inv, args: { ...inv.args, requestKey: inv.idempotencyKey } })
  },
}
