import { afterEach, describe, expect, it, vi } from 'vitest'
import { emailitConnector } from '../src/connectors/adapters/emailit.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_emailit_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'emailit',
    label: 'Emailit Prod',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'ek_test_token',
    },
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

describe('emailit adapter manifest', () => {
  it('classifies itself as the comms category and exposes the emailit kind', () => {
    expect(emailitConnector.manifest.kind).toBe('emailit')
    expect(emailitConnector.manifest.category).toBe('comms')
    expect(emailitConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = emailitConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send.email, logs.list', () => {
    const names = emailitConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['logs.list', 'send.email'])
    const mutations = emailitConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['send.email'])
    const reads = emailitConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['logs.list'])
  })
})

describe('emailit adapter logs.list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /v1/logs with from/to/status/limit threaded as query params and bearer auth', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return jsonResponse({
        logs: [
          { id: 'log_1', status: 'delivered', to: 'a@b.com', at: '2026-01-01T00:00:00Z' },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await emailitConnector.executeRead!({
      source: source(),
      capabilityName: 'logs.list',
      args: {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-02T00:00:00Z',
        status: 'delivered',
        limit: 25,
      },
      idempotencyKey: 'idemp-logs-1',
    })

    expect(capturedUrl).toContain('https://api.emailit.com/v1/logs')
    expect(capturedUrl).toContain('from=2026-01-01T00%3A00%3A00Z')
    expect(capturedUrl).toContain('to=2026-01-02T00%3A00%3A00Z')
    expect(capturedUrl).toContain('status=delivered')
    expect(capturedUrl).toContain('limit=25')
    expect((capturedInit as RequestInit).method).toBe('GET')
    expect((capturedInit as RequestInit).headers).toMatchObject({
      authorization: 'Bearer ek_test_token',
    })
    expect(result.data).toEqual({
      logs: [
        { id: 'log_1', status: 'delivered', to: 'a@b.com', at: '2026-01-01T00:00:00Z' },
      ],
    })
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('omits empty/missing query params (no required args)', async () => {
    let capturedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ logs: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await emailitConnector.executeRead!({
      source: source(),
      capabilityName: 'logs.list',
      args: {},
      idempotencyKey: 'idemp-logs-2',
    })

    expect(capturedUrl).toContain('/v1/logs')
    expect(capturedUrl).not.toContain('from=')
    expect(capturedUrl).not.toContain('to=')
    expect(capturedUrl).not.toContain('status=')
    expect(capturedUrl).not.toContain('limit=')
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )

    await expect(
      emailitConnector.executeRead!({
        source: source(),
        capabilityName: 'logs.list',
        args: { status: 'delivered' },
        idempotencyKey: 'idemp-logs-3',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
