import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentfulConnector } from '../src/connectors/adapters/contentful.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_contentful_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'contentful',
    label: 'contentful test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'cf_secret' },
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

describe('contentful adapter manifest', () => {
  it('exposes the new write capabilities (delete, unpublish) alongside the prior surface', () => {
    const names = contentfulConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'entries.create',
        'entries.delete',
        'entries.get',
        'entries.list',
        'entries.publish',
        'entries.unpublish',
        'entries.update',
      ].sort(),
    )
  })

  it('marks every mutation as a side-effectful, idempotency-tracked write', () => {
    for (const cap of contentfulConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'etag-if-match']).toContain(cap.cas)
    }
  })

  it('marks the newly added mutations as native-idempotency external effects', () => {
    const added = contentfulConnector.manifest.capabilities.filter(
      (c) => c.name === 'entries.delete' || c.name === 'entries.unpublish',
    )
    expect(added).toHaveLength(2)
    for (const cap of added) {
      if (cap.class !== 'mutation') throw new Error(`${cap.name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('contentful entries.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE against /spaces/.../entries/{entryId} with the OAuth bearer token', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await contentfulConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.delete',
      args: { spaceId: 'sp_1', environmentId: 'master', entryId: 'e_42' },
      idempotencyKey: 'k-delete-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/spaces/sp_1/environments/master/entries/e_42')
    expect(String(requestUrl)).not.toContain('/published')
    expect(requestHeaders.authorization).toBe('Bearer cf_secret')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      contentfulConnector.executeMutation!({
        source: source(),
        capabilityName: 'entries.delete',
        args: { spaceId: 'sp_1', environmentId: 'master', entryId: 'e_42' },
        idempotencyKey: 'k-delete-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('contentful entries.unpublish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE against /entries/{entryId}/published with the version header for CAS', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      return jsonResponse({ sys: { id: 'e_42', version: 7 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await contentfulConnector.executeMutation!({
      source: source(),
      capabilityName: 'entries.unpublish',
      args: { spaceId: 'sp_1', environmentId: 'master', entryId: 'e_42', version: 6 },
      idempotencyKey: 'k-unpublish-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/spaces/sp_1/environments/master/entries/e_42/published')
    expect(requestHeaders['x-contentful-version']).toBe('6')
    expect(requestHeaders.authorization).toBe('Bearer cf_secret')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      contentfulConnector.executeMutation!({
        source: source(),
        capabilityName: 'entries.unpublish',
        args: { spaceId: 'sp_1', environmentId: 'master', entryId: 'e_42', version: 6 },
        idempotencyKey: 'k-unpublish-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
