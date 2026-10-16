import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emailoctopusConnector } from '../src/connectors/adapters/emailoctopus.js'
import { whatsappConnector } from '../src/connectors/adapters/whatsapp.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

// Keep the maintained adapters and real HTTP serialization. Only the provider
// network boundary is local, and any other outbound host is refused.
describe('dynamic JSON body fields over HTTP', () => {
  const realFetch = globalThis.fetch
  let close: () => Promise<void>
  let wire: Array<{ path: string; method: string; authorization: string; body: unknown }>

  beforeEach(async () => {
    wire = []
    const server = createServer(async (req, res) => {
      let raw = ''
      for await (const part of req) raw += part
      wire.push({ path: req.url!, method: req.method!, authorization: String(req.headers.authorization), body: JSON.parse(raw) })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ messages: [{ id: 'wamid.protocol' }], id: 'contact' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input))
      if (!['https://graph.facebook.com', 'https://api.emailoctopus.com'].includes(url.origin)) {
        throw new Error('External network forbidden')
      }
      return realFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, init)
    }
    close = () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    await close()
  })

  function source(kind: ResolvedDataSource['kind']): ResolvedDataSource {
    return { id: 'protocol-source', projectId: 'protocol-project', publishedAgentId: null,
      kind, label: 'HTTP protocol fixture', consistencyModel: 'authoritative', scopes: [],
      metadata: {}, credentials: { kind: 'api-key', apiKey: 'protocol-fixture' }, status: 'active' }
  }

  it('sends the native image field with its URL and caption', async () => {
    const result = await whatsappConnector.executeMutation!({
      source: source('whatsapp'), capabilityName: 'media.send', idempotencyKey: 'image-packet',
      args: { phoneNumberId: '20001', to: '+14155550102', type: 'image',
        media: 'https://assets.example.test/asset.png', caption: 'Review this asset: yes / no / feedback' },
    })
    expect(result.status).toBe('committed')
    expect(wire).toEqual([{ path: '/v21.0/20001/messages', method: 'POST', authorization: 'Bearer protocol-fixture',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: '+14155550102', type: 'image',
        image: { link: 'https://assets.example.test/asset.png', caption: 'Review this asset: yes / no / feedback' } } }])
  })

  const tagCases = ['VIP customer', 'café / β', '__proto__', 'constructor'].flatMap(tag => [
    { capabilityName: 'contacts.addTag', tag, enabled: true },
    { capabilityName: 'contacts.removeTag', tag, enabled: false },
  ])
  it.each(tagCases)('$capabilityName preserves the JSON data key $tag', async ({ capabilityName, tag, enabled }) => {
    const result = await emailoctopusConnector.executeMutation!({
      source: source('emailoctopus'), capabilityName, idempotencyKey: `${capabilityName}-${tag}`,
      args: { listId: 'list', contactId: 'contact', tag },
    })
    expect(result.status).toBe('committed')
    expect(wire).toEqual([{ path: '/lists/list/contacts/contact', method: 'PUT', authorization: 'Bearer protocol-fixture',
      body: { tags: { [tag]: enabled } } }])
  })
})
