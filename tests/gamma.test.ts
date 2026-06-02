import { afterEach, describe, expect, it, vi } from 'vitest'
import { gammaConnector } from '../src/connectors/adapters/gamma.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gamma_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gamma',
    label: 'Gamma test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'gamma_secret' },
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

describe('gamma adapter manifest', () => {
  it('classifies itself as the other category and exposes the gamma kind', () => {
    expect(gammaConnector.manifest.kind).toBe('gamma')
    expect(gammaConnector.manifest.category).toBe('other')
    expect(gammaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = gammaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Gamma/i)
  })

  it('covers the full presentation lifecycle and folder organization', () => {
    const names = gammaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'content.generate',
        'generation.status',
        'presentation.delete',
        'presentation.update',
        'folder.create',
      ].sort(),
    )
    const mutations = gammaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['content.generate', 'presentation.delete', 'presentation.update', 'folder.create'].sort(),
    )
  })

  it('marks every mutation as native-idempotent external effect', () => {
    for (const cap of gammaConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('gamma presentation.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /v1/gammas/{gammaId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gammaConnector.executeMutation!({
      source: source(),
      capabilityName: 'presentation.delete',
      args: { gammaId: 'g_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.gamma.app/v1/gammas/g_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      gammaConnector.executeMutation!({
        source: source(),
        capabilityName: 'presentation.delete',
        args: { gammaId: 'g_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('gamma folder.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/folders with the folder body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'folder_1', name: 'Decks' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gammaConnector.executeMutation!({
      source: source(),
      capabilityName: 'folder.create',
      args: { name: 'Decks' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.gamma.app/v1/folders')
    expect(requestBody).toMatchObject({ name: 'Decks' })
    expect(result.status).toBe('committed')
  })
})
