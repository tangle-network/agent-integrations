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
})
