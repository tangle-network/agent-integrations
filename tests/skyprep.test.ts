import { afterEach, describe, expect, it, vi } from 'vitest'
import { skyprepConnector } from '../src/connectors/adapters/skyprep.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_skyprep_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'skyprep',
    label: 'skyprep test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'skyprep_secret' },
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

describe('skyprep adapter manifest', () => {
  it('classifies itself as the other category and exposes the skyprep kind', () => {
    expect(skyprepConnector.manifest.kind).toBe('skyprep')
    expect(skyprepConnector.manifest.category).toBe('other')
    expect(skyprepConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = skyprepConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers enrollment, user lifecycle, and group capabilities', () => {
    const names = skyprepConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('users.enroll.into.course')
    expect(names).toContain('users.enroll.into.group')
    expect(names).toContain('users.update')
    expect(names).toContain('users.unenroll')
    expect(names).toContain('users.create')
    expect(names).toContain('users.delete')
    expect(names).toContain('groups.list')
  })

  it('marks the new write-side capabilities as native-idempotency external effect', () => {
    const caps = skyprepConnector.manifest.capabilities
    const targets = ['users.unenroll', 'users.create', 'users.delete']
    for (const t of targets) {
      const cap = caps.find((c) => c.name === t)
      expect(cap?.class).toBe('mutation')
      if (cap?.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('classifies groups.list as a read', () => {
    const cap = skyprepConnector.manifest.capabilities.find((c) => c.name === 'groups.list')
    expect(cap?.class).toBe('read')
  })
})

describe('skyprep users.unenroll', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/users/{userId}/enrollments/courses/{courseId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )

    const result = await skyprepConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.unenroll',
      args: { userId: 'u_1', courseId: 'c_42' },
      idempotencyKey: 'k-u',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/users/u_1/enrollments/courses/c_42')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      skyprepConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.unenroll',
        args: { userId: 'u_1', courseId: 'c_42' },
        idempotencyKey: 'k-u2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('skyprep users.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a POST to /v1/users with the required body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body as string | undefined
        return jsonResponse({ id: 'u_new' }, { status: 201 })
      }),
    )

    const result = await skyprepConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.create',
      args: {
        email: 'student@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
      idempotencyKey: 'k-c',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/users')
    expect(requestBody ?? '').toContain('student@example.com')
    expect(requestBody ?? '').toContain('Ada')
  })
})

describe('skyprep users.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/users/{userId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )

    await skyprepConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.delete',
      args: { userId: 'u_9' },
      idempotencyKey: 'k-d',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/users/u_9')
  })
})

describe('skyprep groups.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a GET to /v1/groups', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse([{ id: 'g_1', name: 'team' }])
      }),
    )

    await skyprepConnector.executeRead!({
      source: source(),
      capabilityName: 'groups.list',
      args: { limit: 25 },
      idempotencyKey: 'k-g',
    })

    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/v1/groups')
    expect(String(requestUrl)).toContain('limit=25')
  })
})
