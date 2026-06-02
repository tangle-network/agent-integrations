import { afterEach, describe, expect, it, vi } from 'vitest'
import { omniCoConnector } from '../src/connectors/adapters/omni-co.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_omni_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'omni-co',
    label: 'Omni test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'omni_secret' },
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

describe('omni-co adapter manifest', () => {
  it('classifies itself as the database category and exposes the omni-co kind', () => {
    expect(omniCoConnector.manifest.kind).toBe('omni-co')
    expect(omniCoConnector.manifest.category).toBe('database')
    expect(omniCoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = omniCoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Omni/i)
  })

  it('covers documents, queries, schedules and the new write-side capabilities', () => {
    const names = omniCoConnector.manifest.capabilities.map((c) => c.name).sort()
    for (const expected of [
      'documents.create',
      'documents.delete',
      'documents.move',
      'documents.share',
      'documents.update',
      'queries.delete',
      'queries.generate',
      'queries.run',
      'schedules.create',
      'schedules.delete',
      'schedules.edit',
      'schedules.run-now',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks new mutations as native-idempotency external effect', () => {
    const newMutations = ['documents.update', 'queries.delete', 'schedules.run-now', 'documents.share']
    for (const name of newMutations) {
      const cap = omniCoConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `expected capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('omni-co documents.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/documents/{id} with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'doc_1', name: 'Renamed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await omniCoConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.update',
      args: { documentId: 'doc_1', name: 'Renamed' },
      idempotencyKey: 'k-upd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v1/documents/doc_1')
    expect(requestBody).toMatchObject({ name: 'Renamed' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      omniCoConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.update',
        args: { documentId: 'doc_1', name: 'x' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('omni-co queries.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/queries/{queryId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await omniCoConnector.executeMutation!({
      source: source(),
      capabilityName: 'queries.delete',
      args: { queryId: 'q_1' },
      idempotencyKey: 'k-qdel-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/queries/q_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      omniCoConnector.executeMutation!({
        source: source(),
        capabilityName: 'queries.delete',
        args: { queryId: 'q_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('omni-co schedules.run-now', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/dashboards/{identifier}/schedules/{scheduleId}/run', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true, runId: 'run_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await omniCoConnector.executeMutation!({
      source: source(),
      capabilityName: 'schedules.run-now',
      args: { identifier: 'dash_1', scheduleId: 'sched_1' },
      idempotencyKey: 'k-run-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/dashboards/dash_1/schedules/sched_1/run')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      omniCoConnector.executeMutation!({
        source: source(),
        capabilityName: 'schedules.run-now',
        args: { identifier: 'dash_1', scheduleId: 'sched_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('omni-co documents.share', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/documents/{documentId}/shares with the principal payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await omniCoConnector.executeMutation!({
      source: source(),
      capabilityName: 'documents.share',
      args: {
        documentId: 'doc_1',
        principalType: 'user',
        principalId: 'user_1',
        accessLevel: 'viewer',
      },
      idempotencyKey: 'k-share-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/documents/doc_1/shares')
    expect(requestBody).toEqual({ principalType: 'user', principalId: 'user_1', accessLevel: 'viewer' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      omniCoConnector.executeMutation!({
        source: source(),
        capabilityName: 'documents.share',
        args: {
          documentId: 'doc_1',
          principalType: 'user',
          principalId: 'user_1',
          accessLevel: 'viewer',
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
