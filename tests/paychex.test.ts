import { afterEach, describe, expect, it, vi } from 'vitest'
import { paychexConnector } from '../src/connectors/adapters/paychex.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_paychex_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'paychex',
    label: 'Drew Paychex',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'paychex-access-token' },
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

const EXPECTED = [
  'companies.list',
  'companies.get',
  'companies.workers.list',
  'workers.get',
  'workers.compensation.get',
  'workers.compensation.payrates.list',
  'workers.compensation.paystandards.get',
  'workers.communications.list',
  'workers.federaltax.get',
]

describe('paychex adapter manifest', () => {
  it('declares a client_credentials OAuth2 grant with no authorization URL', () => {
    expect(paychexConnector.manifest.kind).toBe('paychex')
    expect(paychexConnector.manifest.category).toBe('hr')
    const auth = paychexConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('paychex auth must be oauth2')
    expect(auth.grantType).toBe('client_credentials')
    expect(auth.authorizationUrl).toBeUndefined()
    expect(auth.tokenUrl).toBe('https://api.paychex.com/auth/oauth/v2/token')
    expect(auth.scopes).toEqual([])
  })

  it('is read-only HR/payroll coverage', () => {
    const names = paychexConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([...EXPECTED].sort())
    expect(paychexConnector.manifest.capabilities.every((c) => c.class === 'read')).toBe(true)
    expect(paychexConnector.manifest.capabilities.some((c) => c.class === 'mutation')).toBe(false)
  })
})

describe('paychex executeRead', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists workers under a company with bearer auth and the documented path', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      return jsonResponse({ content: [{ workerId: 'w1' }] })
    }))

    await paychexConnector.executeRead!({
      source: source(),
      capabilityName: 'companies.workers.list',
      args: { companyId: 'comp_1', statusType: 'ACTIVE', limit: 50 },
      idempotencyKey: 'k',
    })

    const url = new URL(capturedUrl)
    expect(url.origin).toBe('https://api.paychex.com')
    expect(url.pathname).toBe('/companies/comp_1/workers')
    expect(url.searchParams.get('statusType')).toBe('ACTIVE')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(capturedHeaders['authorization']).toBe('Bearer paychex-access-token')
  })

  it('reads pay rates via the /compensation/payrates path (not /payrates)', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ content: [] })
    }))

    await paychexConnector.executeRead!({
      source: source(),
      capabilityName: 'workers.compensation.payrates.list',
      args: { workerId: 'w1' },
      idempotencyKey: 'k',
    })
    expect(new URL(capturedUrl).pathname).toBe('/workers/w1/compensation/payrates')
  })

  it('honors a per-tenant base URL override from metadata.apiBaseUri', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ content: [] })
    }))

    await paychexConnector.executeRead!({
      source: source({ metadata: { apiBaseUri: 'https://api-n1.paychex.com' } }),
      capabilityName: 'companies.list',
      args: {},
      idempotencyKey: 'k',
    })
    expect(new URL(capturedUrl).origin).toBe('https://api-n1.paychex.com')
  })

  it('rejects when a required path arg (workerId) is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      paychexConnector.executeRead!({
        source: source(),
        capabilityName: 'workers.get',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/workerId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })))
    await expect(
      paychexConnector.executeRead!({
        source: source(),
        capabilityName: 'companies.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })))
    await expect(
      paychexConnector.executeRead!({
        source: source(),
        capabilityName: 'companies.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
