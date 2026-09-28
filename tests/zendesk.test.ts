import { afterEach, describe, expect, it, vi } from 'vitest'
import { zendeskConnector } from '../src/connectors/adapters/zendesk.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zendesk_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zendesk',
    label: 'Zendesk test',
    consistencyModel: 'authoritative',
    scopes: ['read', 'write'],
    metadata: { subdomainUrl: 'https://acme.zendesk.com' },
    credentials: { kind: 'oauth2', accessToken: 'zd_access_token' },
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

describe('zendesk tickets.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /api/v2/tickets/{ticketId}.json under the metadata subdomainUrl', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.delete',
      args: { ticketId: '4242' },
      idempotencyKey: 'k-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://acme.zendesk.com/api/v2/tickets/4242.json')
    expect(result.status).toBe('committed')
  })
})

describe('zendesk tickets.merge', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the source ids to /api/v2/tickets/{ticketId}/merge.json', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ticket: { id: 4242 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.merge',
      args: { ticketId: '4242', ids: ['1', '2'] },
      idempotencyKey: 'k-2',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://acme.zendesk.com/api/v2/tickets/4242/merge.json')
    expect(capturedBody).toEqual({ ids: ['1', '2'] })
    expect(result.status).toBe('committed')
  })
})

describe('zendesk tickets.add-comment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the ticket with a public comment payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ticket: { id: 4242 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.add-comment',
      args: { ticketId: '4242', body: 'Replying to customer.', public: true },
      idempotencyKey: 'k-3',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe('https://acme.zendesk.com/api/v2/tickets/4242.json')
    expect(capturedBody).toEqual({
      ticket: { comment: { body: 'Replying to customer.', public: true } },
    })
    expect(result.status).toBe('committed')
  })
})

describe('zendesk users.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the user payload to /api/v2/users/{userId}.json', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ user: { id: 7, name: 'Updated' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.update',
      args: { userId: '7', user: { name: 'Updated' } },
      idempotencyKey: 'k-4',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe('https://acme.zendesk.com/api/v2/users/7.json')
    expect(capturedBody).toEqual({ user: { name: 'Updated' } })
    expect(result.status).toBe('committed')
  })
})

describe('zendesk users.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /api/v2/users/{userId}.json', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zendeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.delete',
      args: { userId: '7' },
      idempotencyKey: 'k-5',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://acme.zendesk.com/api/v2/users/7.json')
    expect(result.status).toBe('committed')
  })
})
