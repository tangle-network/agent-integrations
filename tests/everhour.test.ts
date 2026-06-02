import { afterEach, describe, expect, it, vi } from 'vitest'
import { everhourConnector } from '../src/connectors/adapters/everhour.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_everhour_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'everhour',
    label: 'Everhour test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'everhour_secret' },
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

describe('everhour adapter manifest', () => {
  it('classifies itself as the other category and exposes the everhour kind', () => {
    expect(everhourConnector.manifest.kind).toBe('everhour')
    expect(everhourConnector.manifest.category).toBe('other')
    expect(everhourConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = everhourConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: tasks, timers, and time entries', () => {
    const names = everhourConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tasks.create',
        'timers.start',
        'timers.stop',
        'time.create',
        'time.update',
        'time.delete',
      ].sort(),
    )
    const mutations = everhourConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'tasks.create',
        'timers.start',
        'timers.stop',
        'time.create',
        'time.update',
        'time.delete',
      ].sort(),
    )
  })

  it('marks the new time.* mutations as native-idempotency externalEffect', () => {
    const target = new Set(['time.create', 'time.update', 'time.delete'])
    const caps = everhourConnector.manifest.capabilities.filter((c) => target.has(c.name))
    expect(caps).toHaveLength(3)
    for (const c of caps) {
      if (c.class !== 'mutation') throw new Error(`${c.name} must be a mutation`)
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('everhour time.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /tasks/{taskId}/time with the body fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'time_1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await everhourConnector.executeMutation!({
      source: source(),
      capabilityName: 'time.create',
      args: {
        taskId: 'task_1',
        time: 3600,
        date: '2026-06-02',
        user: 42,
        comment: 'Did the thing',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.everhour.com/api/tasks/task_1/time')
    expect(requestBody).toEqual({
      time: 3600,
      date: '2026-06-02',
      user: 42,
      comment: 'Did the thing',
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      everhourConnector.executeMutation!({
        source: source(),
        capabilityName: 'time.create',
        args: {
          taskId: 'task_1',
          time: 3600,
          date: '2026-06-02',
          user: 42,
          comment: 'Did the thing',
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('everhour time.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs against /tasks/{taskId}/time/{timeId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'time_1', time: 7200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await everhourConnector.executeMutation!({
      source: source(),
      capabilityName: 'time.update',
      args: {
        taskId: 'task_1',
        timeId: 'time_1',
        time: 7200,
        date: '2026-06-02',
        comment: 'Updated',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe(
      'https://api.everhour.com/api/tasks/task_1/time/time_1',
    )
    expect(requestBody).toEqual({
      time: 7200,
      date: '2026-06-02',
      comment: 'Updated',
    })
  })
})

describe('everhour time.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /tasks/{taskId}/time/{timeId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await everhourConnector.executeMutation!({
      source: source(),
      capabilityName: 'time.delete',
      args: { taskId: 'task_1', timeId: 'time_1' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://api.everhour.com/api/tasks/task_1/time/time_1',
    )
  })
})
