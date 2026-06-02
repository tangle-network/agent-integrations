import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshserviceConnector } from '../src/connectors/adapters/freshservice.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_freshservice_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'freshservice',
    label: 'Freshservice test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { domainUrl: 'https://acme.freshservice.com' },
    credentials: { kind: 'api-key', apiKey: 'fs-secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('freshservice adapter manifest', () => {
  it('classifies itself as the crm category and exposes the freshservice kind', () => {
    expect(freshserviceConnector.manifest.kind).toBe('freshservice')
    expect(freshserviceConnector.manifest.category).toBe('crm')
    expect(freshserviceConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a setup hint that mentions the API key', () => {
    const auth = freshserviceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/API key/i)
  })

  it('covers the catalog actions plus the update/delete/close write surface', () => {
    const names = freshserviceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.list',
        'tickets.get',
        'tickets.create',
        'tickets.update',
        'tickets.delete',
        'tickets.close',
        'tickets.note',
        'tickets.requestApproval',
        'requesters.list',
        'requesters.create',
      ].sort(),
    )

    const reads = freshserviceConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = freshserviceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['requesters.list', 'tickets.get', 'tickets.list'])
    expect(mutations).toEqual(
      [
        'requesters.create',
        'tickets.create',
        'tickets.update',
        'tickets.delete',
        'tickets.close',
        'tickets.note',
        'tickets.requestApproval',
      ].sort(),
    )
  })

  it('marks every mutation with a CAS strategy (defaults to native-idempotency)', () => {
    for (const cap of freshserviceConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBeDefined()
    }
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    for (const name of ['tickets.update', 'tickets.delete', 'tickets.close']) {
      const cap = freshserviceConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('freshservice tickets.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /api/v2/tickets/{ticketId} with the provided fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ticket: { id: 7 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freshserviceConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.update',
      args: { ticketId: '7', priority: 3, status: 3 },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://acme.freshservice.com/api/v2/tickets/7')
    expect(requestBody).toMatchObject({ priority: 3, status: 3 })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      freshserviceConnector.executeMutation!({
        source: source(),
        capabilityName: 'tickets.update',
        args: { ticketId: '7' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('freshservice tickets.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /api/v2/tickets/{ticketId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freshserviceConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.delete',
      args: { ticketId: '7' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://acme.freshservice.com/api/v2/tickets/7')
  })
})

describe('freshservice tickets.close', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /api/v2/tickets/{ticketId} with status=5 (Closed)', async () => {
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ticket: { id: 7, status: 5 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freshserviceConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.close',
      args: { ticketId: '7' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestBody).toEqual({ status: 5 })
  })
})
