import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendinblueConnector } from '../src/connectors/adapters/sendinblue.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sendinblue_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sendinblue',
    label: 'sendinblue test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'sib_secret' },
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

describe('sendinblue adapter manifest', () => {
  it('classifies itself as the crm category and exposes the sendinblue kind', () => {
    expect(sendinblueConnector.manifest.kind).toBe('sendinblue')
    expect(sendinblueConnector.manifest.category).toBe('crm')
    expect(sendinblueConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = sendinblueConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Sendinblue/i)
  })

  it('covers contacts, lists, campaigns, and transactional capability surface', () => {
    const names = sendinblueConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'campaigns.send',
        'contacts.createOrUpdate',
        'contacts.delete',
        'contacts.get',
        'lists.addContacts',
        'lists.create',
        'lists.delete',
        'lists.get',
        'transactional.send',
      ].sort(),
    )
    const mutations = sendinblueConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'campaigns.send',
        'contacts.createOrUpdate',
        'contacts.delete',
        'lists.addContacts',
        'lists.create',
        'lists.delete',
        'transactional.send',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency with externalEffect=true', () => {
    const mutations = sendinblueConnector.manifest.capabilities.filter(
      (c) => c.class === 'mutation',
    )
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('sendinblue lists.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v3/contacts/lists with name and folderId in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 99 }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendinblueConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.create',
      args: { name: 'Newsletter', folderId: 7 },
      idempotencyKey: 'k-list-create',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/contacts/lists')
    expect(requestBody).toEqual({ name: 'Newsletter', folderId: 7 })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sendinblueConnector.executeMutation!({
        source: source(),
        capabilityName: 'lists.create',
        args: { name: 'x', folderId: 1 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sendinblue lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v3/contacts/lists/{listId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendinblueConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { listId: 12 },
      idempotencyKey: 'k-list-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v3/contacts/lists/12')
  })
})

describe('sendinblue lists.addContacts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v3/contacts/lists/{listId}/contacts/add with emails', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ contacts: { success: ['a@example.com'], failure: [] } }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendinblueConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.addContacts',
      args: { listId: 12, emails: ['a@example.com', 'b@example.com'] },
      idempotencyKey: 'k-add',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/contacts/lists/12/contacts/add')
    expect(requestBody).toEqual({ emails: ['a@example.com', 'b@example.com'] })
  })
})

describe('sendinblue campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v3/emailCampaigns/{campaignId}/sendNow', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendinblueConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { campaignId: 7 },
      idempotencyKey: 'k-send',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/emailCampaigns/7/sendNow')
  })
})

describe('sendinblue transactional.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v3/smtp/email with the args as the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ messageId: '<abc@smtp-relay.sendinblue.com>' }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const args = {
      sender: { email: 'noreply@example.com', name: 'Bot' },
      to: [{ email: 'user@example.com' }],
      subject: 'hi',
      htmlContent: '<p>hi</p>',
    }
    const result = await sendinblueConnector.executeMutation!({
      source: source(),
      capabilityName: 'transactional.send',
      args,
      idempotencyKey: 'k-tx',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v3/smtp/email')
    expect(requestBody).toEqual(args)
  })
})
