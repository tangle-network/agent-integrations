import { afterEach, describe, expect, it, vi } from 'vitest'
import { altTextAiConnector } from '../src/connectors/adapters/alt-text-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_alttext_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'alt-text-ai',
    label: 'alt-text-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'alttext_secret' },
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

describe('alt-text-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the alt-text-ai kind', () => {
    expect(altTextAiConnector.manifest.kind).toBe('alt-text-ai')
    expect(altTextAiConnector.manifest.category).toBe('other')
    expect(altTextAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = altTextAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers single + batch + delete write actions', () => {
    const names = altTextAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'images.generateAltText',
        'images.batchGenerateAltText',
        'images.deleteResult',
      ].sort(),
    )
    const mutations = altTextAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'images.generateAltText',
        'images.batchGenerateAltText',
        'images.deleteResult',
      ].sort(),
    )
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    for (const name of ['images.batchGenerateAltText', 'images.deleteResult']) {
      const cap = altTextAiConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('alt-text-ai images.batchGenerateAltText', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/images/bulk with the images array', async () => {
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

    const result = await altTextAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'images.batchGenerateAltText',
      args: {
        images: [
          { image: 'https://x.example/1.png' },
          { image: 'https://x.example/2.png', keywords: ['hat'] },
        ],
      },
      idempotencyKey: 'batch-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://alttext.ai/api/v1/images/bulk')
    expect(capturedHeaders['X-API-Key']).toBe('alttext_secret')
    expect(capturedBody).toEqual({
      images: [
        { image: 'https://x.example/1.png' },
        { image: 'https://x.example/2.png', keywords: ['hat'] },
      ],
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      altTextAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'images.batchGenerateAltText',
        args: { images: [{ image: 'https://x.example/1.png' }] },
        idempotencyKey: 'batch-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('alt-text-ai images.deleteResult', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE to /api/v1/images/{id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await altTextAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'images.deleteResult',
      args: { id: 'img_123' },
      idempotencyKey: 'del-1',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://alttext.ai/api/v1/images/img_123')
    expect(result.status).toBe('committed')
  })
})
