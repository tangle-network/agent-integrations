import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendgridConnector } from '../sendgrid.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_sendgrid',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'sendgrid',
  label: 'sendgrid',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'SG.test-api-key' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendgrid adapter', () => {
  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(sendgridConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and the SendGrid mail+marketing surface', () => {
    expect(sendgridConnector.manifest.kind).toBe('sendgrid')
    expect(sendgridConnector.manifest.displayName).toBe('SendGrid')
    expect(sendgridConnector.manifest.category).toBe('comms')
    expect(sendgridConnector.manifest.auth.kind).toBe('api-key')
    const names = sendgridConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'contacts.delete',
      'contacts.get',
      'contacts.search',
      'contacts.upsert',
      'lists.addContacts',
      'lists.create',
      'lists.delete',
      'lists.removeContacts',
      'lists.search',
      'mail.send',
      'suppressions.create',
    ])
    const readers = sendgridConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutators = sendgridConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(readers).toEqual(['contacts.search', 'contacts.get', 'lists.search'])
    expect(mutators).toEqual([
      'mail.send',
      'contacts.upsert',
      'lists.create',
      'contacts.delete',
      'lists.delete',
      'lists.addContacts',
      'lists.removeContacts',
      'suppressions.create',
    ])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof sendgridConnector.executeRead).toBe('function')
    expect(typeof sendgridConnector.executeMutation).toBe('function')
  })

  it('sends mail via POST /v3/mail/send with bearer auth and the SendGrid payload shape', async () => {
    const fetchMock = mockFetch({}, { status: 202 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'mail.send',
      args: {
        personalizations: [{ to: [{ email: 'ada@example.com' }], subject: 'Hi' }],
        from: { email: 'noreply@tangle.tools', name: 'Tangle' },
        content: [{ type: 'text/plain', value: 'Hello' }],
      },
      idempotencyKey: 'mail_1',
    }

    const result = await sendgridConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.sendgrid.com/v3/mail/send')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer SG.test-api-key',
      'content-type': 'application/json',
    })
    const body = JSON.parse(String(init.body))
    expect(body.from).toEqual({ email: 'noreply@tangle.tools', name: 'Tangle' })
    expect(body.personalizations[0].to[0].email).toBe('ada@example.com')
    expect(body.content[0].value).toBe('Hello')
  })

  it('searches contacts via POST /v3/marketing/contacts/search with the SGQL query body', async () => {
    const fetchMock = mockFetch({ result: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'contacts.search',
      args: { query: "email LIKE '%@example.com'" },
      idempotencyKey: 'search_1',
    }

    await sendgridConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.sendgrid.com/v3/marketing/contacts/search')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ query: "email LIKE '%@example.com'" })
  })

  it('paginates lists via GET /v3/marketing/lists with query params', async () => {
    const fetchMock = mockFetch({ result: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'lists.search',
      args: { page_size: 50 },
      idempotencyKey: 'lists_1',
    }

    await sendgridConnector.executeRead!(invocation)

    const [url] = fetchMock.mock.calls[0]! as unknown as [URL]
    expect(url.pathname).toBe('/v3/marketing/lists')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.has('page_token')).toBe(false)
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
