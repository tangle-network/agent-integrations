import { afterEach, describe, expect, it, vi } from 'vitest'
import { dubConnector } from '../src/connectors/adapters/dub.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_dub_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'dub',
    label: 'Dub test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'dub_secret' },
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

describe('dub adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = dubConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('dub tags.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tags with name and color in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'tag_1', name: 'marketing', color: 'blue' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await dubConnector.executeMutation!({
      source: source(),
      capabilityName: 'tags.create',
      args: { name: 'marketing', color: 'blue' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.dub.co/tags')
    expect(requestBody).toEqual({ name: 'marketing', color: 'blue' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      dubConnector.executeMutation!({
        source: source(),
        capabilityName: 'tags.create',
        args: { name: 'marketing', color: 'blue' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
