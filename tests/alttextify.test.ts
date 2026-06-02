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

describe('alttextify adapter manifest', () => {
  it('classifies itself as the doc category and exposes the alttextify kind', () => {
    expect(alttextifyConnector.manifest.kind).toBe('alttextify')
    expect(alttextifyConnector.manifest.category).toBe('doc')
    expect(alttextifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = alttextifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AltTextify/i)
  })

  it('exposes the generate + batch + delete capability surface', () => {
    const names = alttextifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['generate.alt.text', 'batch.generate.alt.text', 'result.delete'].sort(),
    )
    const mutations = alttextifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['generate.alt.text', 'batch.generate.alt.text', 'result.delete'].sort(),
    )
  })

  it('marks new mutations as native-idempotency external effect', () => {
    for (const name of ['batch.generate.alt.text', 'result.delete']) {
      const cap = alttextifyConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      alttextifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'batch.generate.alt.text',
        args: {
          images: [{ image: 'data:image/png;base64,abc' }],
          lang: 'en',
          async: false,
        },
        idempotencyKey: 'batch-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
