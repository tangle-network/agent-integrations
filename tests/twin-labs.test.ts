import { afterEach, describe, expect, it, vi } from 'vitest'
import { twinLabsConnector } from '../src/connectors/adapters/twin-labs.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_twin_labs_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'twin-labs',
    label: 'Twin Labs',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'tl-test-key' },
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

describe('twin-labs adapter manifest', () => {
  it('classifies itself as the other category and exposes the twin-labs kind', () => {
    expect(twinLabsConnector.manifest.kind).toBe('twin-labs')
    expect(twinLabsConnector.manifest.category).toBe('other')
    expect(twinLabsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = twinLabsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the browsing task action set', () => {
    const names = twinLabsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['browsing.get', 'browsing.start', 'browsing.stop'])
    const mutations = twinLabsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['browsing.start', 'browsing.stop'])
    const reads = twinLabsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['browsing.get'])
  })
})

describe('twin-labs browsing.stop', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /sessions/{sessionId}/stop and returns a committed result', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      return jsonResponse({ ok: true, sessionId: 'sess_123' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twinLabsConnector.executeMutation!({
      source: source(),
      capabilityName: 'browsing.stop',
      args: { sessionId: 'sess_123' },
      idempotencyKey: 'idemp-stop-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toMatch(/\/sessions\/sess_123\/stop$/)
    expect(result.status).toBe('committed')
    expect(result).toMatchObject({
      status: 'committed',
      data: { ok: true, sessionId: 'sess_123' },
      idempotentReplay: false,
    })
  })

  it('throws when sessionId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      twinLabsConnector.executeMutation!({
        source: source(),
        capabilityName: 'browsing.stop',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: sessionId/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      twinLabsConnector.executeMutation!({
        source: source(),
        capabilityName: 'browsing.stop',
        args: { sessionId: 'sess_123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('twin-labs browsing.get', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /sessions/{sessionId} and returns status, current_url, screenshot_url', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      return jsonResponse({
        status: 'running',
        current_url: 'https://example.com/page',
        screenshot_url: 'https://cdn.twinlabs.ai/shots/sess_123.png',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await twinLabsConnector.executeRead!({
      source: source(),
      capabilityName: 'browsing.get',
      args: { sessionId: 'sess_123' },
      idempotencyKey: 'idemp-get-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toMatch(/\/sessions\/sess_123(\?|$)/)
    expect(result.data).toMatchObject({
      status: 'running',
      current_url: 'https://example.com/page',
      screenshot_url: 'https://cdn.twinlabs.ai/shots/sess_123.png',
    })
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('throws when sessionId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      twinLabsConnector.executeRead!({
        source: source(),
        capabilityName: 'browsing.get',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: sessionId/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      twinLabsConnector.executeRead!({
        source: source(),
        capabilityName: 'browsing.get',
        args: { sessionId: 'sess_123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
