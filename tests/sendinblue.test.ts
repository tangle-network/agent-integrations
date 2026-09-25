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
