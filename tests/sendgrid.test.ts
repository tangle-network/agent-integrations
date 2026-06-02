import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendgridConnector } from '../src/connectors/adapters/sendgrid.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sendgrid_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sendgrid',
    label: 'sendgrid test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'sg_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('sendgrid adapter manifest', () => {
  it('classifies itself as the comms category and exposes the sendgrid kind', () => {
    expect(sendgridConnector.manifest.kind).toBe('sendgrid')
    expect(sendgridConnector.manifest.category).toBe('comms')
    expect(sendgridConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = sendgridConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SendGrid/i)
  })

  it('exposes the expanded mutation surface for contacts, lists, and suppressions', () => {
    const names = sendgridConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
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
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency with externalEffect=true', () => {
    const mutations = sendgridConnector.manifest.capabilities.filter(
      (c) => c.class === 'mutation',
    )
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('sendgrid contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v3/marketing/contacts with the ids query param', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ job_id: 'job_1' }, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendgridConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { ids: 'a,b,c' },
      idempotencyKey: 'k-del-contacts',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v3/marketing/contacts')
    expect(String(requestUrl)).toContain('ids=a%2Cb%2Cc')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sendgridConnector.executeMutation!({
        source: source(),
        capabilityName: 'contacts.delete',
        args: { ids: 'a' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sendgrid lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v3/marketing/lists/{listId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendgridConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { listId: 'list_1', delete_contacts: true },
      idempotencyKey: 'k-del-list',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v3/marketing/lists/list_1')
    expect(String(requestUrl)).toContain('delete_contacts=true')
  })
})

describe('sendgrid lists.addContacts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v3/marketing/contacts with list_ids and contacts in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ job_id: 'job_2' }, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendgridConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.addContacts',
      args: {
        listId: 'list_1',
        contacts: [{ email: 'a@example.com' }],
      },
      idempotencyKey: 'k-add',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v3/marketing/contacts')
    expect(requestBody).toEqual({
      list_ids: ['list_1'],
      contacts: [{ email: 'a@example.com' }],
    })
  })
})

describe('sendgrid lists.removeContacts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v3/marketing/lists/{listId}/contacts', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendgridConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.removeContacts',
      args: { listId: 'list_1', contact_ids: 'c1,c2' },
      idempotencyKey: 'k-rm',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v3/marketing/lists/list_1/contacts')
    expect(String(requestUrl)).toContain('contact_ids=c1%2Cc2')
  })
})

describe('sendgrid suppressions.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v3/asm/groups/{groupId}/suppressions with recipient_emails', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ recipient_emails: ['x@example.com'] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendgridConnector.executeMutation!({
      source: source(),
      capabilityName: 'suppressions.create',
      args: { groupId: '42', recipient_emails: ['x@example.com'] },
      idempotencyKey: 'k-suppr',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/asm/groups/42/suppressions')
    expect(requestBody).toEqual({ recipient_emails: ['x@example.com'] })
  })
})
