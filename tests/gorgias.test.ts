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
  it('declares oauth2 auth with per-tenant subdomain templates', () => {
    const auth = gorgiasConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toContain('{subdomain}')
    expect(auth.scopes).toContain('tickets:write')
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
