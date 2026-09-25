import { afterEach, describe, expect, it, vi } from 'vitest'
import { alttextifyConnector } from '../src/connectors/adapters/alttextify.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_alttextify_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'alttextify',
    label: 'alttextify test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'alttextify_secret' },
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

describe('alttextify batch.generate.alt.text', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/image/raw/bulk with the images array', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ids: ['1', '2'] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await alttextifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'batch.generate.alt.text',
      args: {
        images: [{ image: 'data:image/png;base64,abc' }, { image: 'data:image/png;base64,def' }],
        lang: 'en',
        async: false,
      },
      idempotencyKey: 'batch-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.alttextify.net/api/v1/image/raw/bulk')
    expect(capturedHeaders['X-API-Key']).toBe('alttextify_secret')
    expect(capturedBody).toEqual({
      images: [{ image: 'data:image/png;base64,abc' }, { image: 'data:image/png;base64,def' }],
      lang: 'en',
      async: false,
    })
    expect(result.status).toBe('committed')
  })
})

describe('alttextify result.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /api/v1/image/{id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await alttextifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'result.delete',
      args: { id: 'img_123' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.alttextify.net/api/v1/image/img_123')
    expect(result.status).toBe('committed')
  })
})
