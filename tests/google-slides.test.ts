import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleSlidesConnector } from '../src/connectors/adapters/google-slides.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_slides_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-slides',
    label: 'slides test',
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/presentations'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
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

describe('google-slides adapter manifest', () => {
  it('classifies itself as the doc category and exposes the google-slides kind', () => {
    expect(googleSlidesConnector.manifest.kind).toBe('google-slides')
    expect(googleSlidesConnector.manifest.category).toBe('doc')
    expect(googleSlidesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = googleSlidesConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set plus write-side update + duplicate', () => {
    const names = googleSlidesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'charts.refresh',
        'presentation.create',
        'presentation.get',
        'presentation.update',
        'slides.duplicate',
      ].sort(),
    )
    const mutations = googleSlidesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['charts.refresh', 'presentation.create', 'presentation.update', 'slides.duplicate'].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['presentation.update', 'slides.duplicate']) {
      const cap = googleSlidesConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('google-slides slides.duplicate', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a duplicateObject batchUpdate to /v1/presentations/{id}:batchUpdate', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ presentationId: 'p_1', replies: [{ duplicateObject: { objectId: 'new_slide' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await googleSlidesConnector.executeMutation!({
      source: source(),
      capabilityName: 'slides.duplicate',
      args: { presentationId: 'pres_1', objectId: 'slide_42', objectIds: {} },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://slides.googleapis.com/v1/presentations/pres_1:batchUpdate')
    expect(result.status).toBe('committed')
    expect(requestBody).toMatchObject({
      requests: [{ duplicateObject: { objectId: 'slide_42' } }],
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      googleSlidesConnector.executeMutation!({
        source: source(),
        capabilityName: 'slides.duplicate',
        args: { presentationId: 'pres_1', objectId: 'slide_42', objectIds: {} },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
