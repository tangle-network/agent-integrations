import { afterEach, describe, expect, it, vi } from 'vitest'
import { contiguityConnector } from '../src/connectors/adapters/contiguity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_contiguity_1', projectId: 'proj_1', publishedAgentId: null,
  kind: 'contiguity', label: 'test', consistencyModel: 'advisory', scopes: [], metadata: {},
  credentials: { kind: 'api-key', apiKey: 'contiguity_secret' }, status: 'active',
}
const email = { to: 'recipient@example.com', from: 'sender@example.com', subject: 'hello', body: 'world', replyTo: 'reply@example.com' }
afterEach(() => vi.unstubAllGlobals())

describe('contiguity manifest', () => {
  it('retains public kind/category and API-key auth', () => {
    expect(contiguityConnector.manifest).toMatchObject({ kind: 'contiguity', category: 'crm', auth: { kind: 'api-key' }, defaultConsistencyModel: 'advisory' })
  })
  it('preserves send action names and adds owned-number discovery', () => {
    expect(contiguityConnector.manifest.capabilities.map((c) => c.name).sort()).toEqual(['email.send', 'messages.send_imessage', 'messages.send_text', 'numbers.list', 'sms.send'])
  })
  it('does not claim undocumented provider-native idempotency', () => {
    const mutations = contiguityConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations).toHaveLength(4)
    for (const cap of mutations) expect(cap).toMatchObject({ cas: 'none', externalEffect: true })
  })
})

describe('contiguity wire contracts', () => {
  it.each(['text/plain', 'text/html'] as const)('maps %s body and reply_to to POST /send/email', async (contentType) => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'request', data: { message_id: 'message' } }))
    vi.stubGlobal('fetch', send)
    const result = await contiguityConnector.executeMutation!({ source, capabilityName: 'email.send', args: { ...email, contentType, text: 'unapproved', html: 'unapproved' }, idempotencyKey: 'key' })
    expect(result.status).toBe('committed')
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]!
    expect(String(url)).toBe('https://api.contiguity.com/send/email')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer contiguity_secret')
    expect(JSON.parse(String(init?.body))).toEqual({ to: email.to, from: email.from, subject: email.subject, [contentType === 'text/html' ? 'html' : 'text']: 'world', reply_to: email.replyTo })
  })
  it('rejects unsupported content types before a request', async () => {
    const send = vi.fn(); vi.stubGlobal('fetch', send)
    await expect(contiguityConnector.executeMutation!({ source, capabilityName: 'email.send', args: { ...email, contentType: 'application/javascript' }, idempotencyKey: 'invalid-content' })).rejects.toThrow('contentType')
    expect(send).not.toHaveBeenCalled()
  })
  it('surfaces credential expiration without retrying', async () => {
    const send = vi.fn(async () => new Response('unauthorized', { status: 401 })); vi.stubGlobal('fetch', send)
    await expect(contiguityConnector.executeMutation!({ source, capabilityName: 'email.send', args: email, idempotencyKey: 'key' })).rejects.toMatchObject({ name: 'CredentialsExpired' })
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('sends SMS to /send/text with the explicit sender', async () => {
    const send = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'request' })); vi.stubGlobal('fetch', send)
    const args = { to: '+15550000001', from: '+15550000002', message: 'Hello' }
    await contiguityConnector.executeMutation!({ source, capabilityName: 'sms.send', args, idempotencyKey: 'key' })
    expect(String(send.mock.calls[0]![0])).toBe('https://api.contiguity.com/send/text')
    expect(JSON.parse(String(send.mock.calls[0]![1]?.body))).toEqual(args)
  })
  it('does not silently pick a sender when none was authorized', async () => {
    const send = vi.fn(); vi.stubGlobal('fetch', send)
    await expect(contiguityConnector.executeMutation!({ source, capabilityName: 'sms.send', args: { to: '+15550000001', message: 'Hello' }, idempotencyKey: 'missing-sender' })).rejects.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})
