import { afterEach, describe, expect, it, vi } from 'vitest'
import { gorgiasConnector } from '../src/connectors/adapters/gorgias.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gorgias_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gorgias',
    label: 'gorgias test',
    consistencyModel: 'authoritative',
    scopes: ['tickets:read', 'tickets:write', 'messages:write'],
    metadata: { subdomainUrl: 'https://acme.gorgias.com' },
    credentials: { kind: 'oauth2', accessToken: 'tok_abc' },
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

describe('gorgias adapter manifest', () => {
  it('classifies itself as the crm category and exposes the gorgias kind', () => {
    expect(gorgiasConnector.manifest.kind).toBe('gorgias')
    expect(gorgiasConnector.manifest.category).toBe('crm')
    expect(gorgiasConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with per-tenant subdomain templates', () => {
    const auth = gorgiasConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toContain('{subdomain}')
    expect(auth.scopes).toContain('tickets:write')
  })

  it('covers the catalog action set plus tickets.close', () => {
    const names = gorgiasConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.search',
        'tickets.get',
        'tickets.create',
        'tickets.update',
        'tickets.close',
        'messages.create',
        'customers.search',
        'customers.create',
      ].sort(),
    )
    const mutations = gorgiasConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'tickets.create',
        'tickets.update',
        'tickets.close',
        'messages.create',
        'customers.create',
      ].sort(),
    )
  })

  it('marks the tickets.close mutation as native-idempotency + externalEffect=true', () => {
    const cap = gorgiasConnector.manifest.capabilities.find((c) => c.name === 'tickets.close')
    expect(cap).toBeDefined()
    if (!cap || cap.class !== 'mutation') throw new Error('tickets.close must be a mutation')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('gorgias tickets.close', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /api/tickets/{ticketId} with status=closed against the tenant subdomain', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 42, status: 'closed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gorgiasConnector.executeMutation!({
      source: source(),
      capabilityName: 'tickets.close',
      args: { ticketId: 42 },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://acme.gorgias.com/api/tickets/42')
    expect(requestBody).toMatchObject({ status: 'closed' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      gorgiasConnector.executeMutation!({
        source: source(),
        capabilityName: 'tickets.close',
        args: { ticketId: 1 },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
