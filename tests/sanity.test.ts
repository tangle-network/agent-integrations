import { afterEach, describe, expect, it, vi } from 'vitest'
import { sanityConnector } from '../src/connectors/adapters/sanity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sanity_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sanity',
    label: 'sanity test',
    consistencyModel: 'authoritative',
    scopes: ['read', 'write'],
    metadata: { apiHost: 'https://abc123.api.sanity.io' },
    credentials: { kind: 'oauth2', accessToken: 'sanity_access_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('sanity adapter manifest', () => {
  it('classifies itself as doc with oauth2 auth', () => {
    expect(sanityConnector.manifest.kind).toBe('sanity')
    expect(sanityConnector.manifest.category).toBe('doc')
    expect(sanityConnector.manifest.auth.kind).toBe('oauth2')
  })

  it('covers the read + mutation capability surface including the new write-side adds', () => {
    const names = sanityConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.create',
        'documents.createOrReplace',
        'documents.delete',
        'documents.delete-batch',
        'documents.get',
        'documents.patch',
        'documents.publish',
        'documents.query',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency external effect', () => {
    const newOnes = new Set([
      'documents.createOrReplace',
      'documents.publish',
      'documents.delete-batch',
    ])
    const caps = sanityConnector.manifest.capabilities.filter((c) => newOnes.has(c.name))
    expect(caps.length).toBe(3)
    for (const cap of caps) {
      if (cap.class !== 'mutation') throw new Error(`${cap.name} should be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('sanity documents.createOrReplace', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a single createOrReplace mutation to /data/mutate/{dataset}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ transactionId: 'tx_1', results: [{ id: 'doc1', operation: 'update' }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const document = { _id: 'doc1', _type: 'post', title: 'Hello' }
    const result = await sanityConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.createOrReplace',
      args: { dataset: 'production', apiVersion: 'v2025-02-19', document },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain(
      'https://abc123.api.sanity.io/v2025-02-19/data/mutate/production',
    )
    expect(requestBody).toMatchObject({
      mutations: [{ createOrReplace: document }],
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sanityConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.createOrReplace',
        args: { dataset: 'production', apiVersion: 'v2025-02-19', document: { _id: 'd', _type: 't' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sanity documents.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a sanity.action.document.publish action to /data/actions/{dataset}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ transactionId: 'tx_2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sanityConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.publish',
      args: { dataset: 'production', apiVersion: 'v2025-02-19', draftId: 'drafts.doc1', publishedId: 'doc1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain(
      'https://abc123.api.sanity.io/v2025-02-19/data/actions/production',
    )
    expect(requestBody).toEqual({
      actions: [
        {
          actionType: 'sanity.action.document.publish',
          draftId: 'drafts.doc1',
          publishedId: 'doc1',
        },
      ],
    })
  })
})

describe('sanity documents.delete-batch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs a single GROQ delete-by-query mutation with the supplied ids', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ transactionId: 'tx_3', results: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sanityConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.delete-batch',
      args: { dataset: 'production', apiVersion: 'v2025-02-19', documentIds: ['a', 'b', 'c'] },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain(
      'https://abc123.api.sanity.io/v2025-02-19/data/mutate/production',
    )
    expect(requestBody).toEqual({
      mutations: [
        {
          delete: {
            query: '*[_id in $ids]',
            params: { ids: ['a', 'b', 'c'] },
          },
        },
      ],
    })
  })
})
