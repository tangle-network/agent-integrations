import { afterEach, describe, expect, it, vi } from 'vitest'
import { ticktickConnector } from '../src/connectors/adapters/ticktick.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_ticktick_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'ticktick',
    label: 'ticktick test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ticktick_access', refreshToken: 'ticktick_refresh' },
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

describe('ticktick adapter manifest', () => {
  it('classifies itself as the other category and exposes the ticktick kind', () => {
    expect(ticktickConnector.manifest.kind).toBe('ticktick')
    expect(ticktickConnector.manifest.category).toBe('other')
    expect(ticktickConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with TickTick-specific endpoints', () => {
    const auth = ticktickConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/ticktick.com/)
    expect(auth.tokenUrl).toMatch(/ticktick.com/)
  })

  it('covers tasks and project surface plus new project CRUD and task move', () => {
    const names = ticktickConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.update')
    expect(names).toContain('tasks.get')
    expect(names).toContain('tasks.find')
    expect(names).toContain('tasks.complete')
    expect(names).toContain('tasks.delete')
    expect(names).toContain('tasks.move')
    expect(names).toContain('projects.get')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.update')
    expect(names).toContain('projects.delete')
  })

  it('marks mutations and read operations correctly', () => {
    const mutations = ticktickConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('tasks.create')
    expect(mutations).toContain('tasks.update')
    expect(mutations).toContain('tasks.complete')
    expect(mutations).toContain('tasks.delete')
    expect(mutations).toContain('tasks.move')
    expect(mutations).toContain('projects.create')
    expect(mutations).toContain('projects.update')
    expect(mutations).toContain('projects.delete')

    const reads = ticktickConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('tasks.get')
    expect(reads).toContain('tasks.find')
    expect(reads).toContain('projects.get')
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['projects.create', 'projects.update', 'projects.delete', 'tasks.move']
    for (const name of expected) {
      const cap = ticktickConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('ticktick projects.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/project with the project body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'proj_new' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ticktickConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.create',
      args: { name: 'Inbox 2' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.ticktick.com/v2/project')
    expect(requestBody).toMatchObject({ name: 'Inbox 2' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      ticktickConnector.executeMutation!({
        source: source(),
        capabilityName: 'projects.create',
        args: { name: 'x' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('ticktick projects.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/project/{projectId} with the update body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'proj_abc' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await ticktickConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.update',
      args: { projectId: 'proj_abc', name: 'Renamed' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.ticktick.com/v2/project/proj_abc')
    expect(requestBody).toMatchObject({ name: 'Renamed' })
  })
})

describe('ticktick projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/project/{projectId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await ticktickConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { projectId: 'proj_abc' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.ticktick.com/v2/project/proj_abc')
    expect(result.status).toBe('committed')
  })
})

describe('ticktick tasks.move', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/task/{taskId}/move with destination projectId', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ moved: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await ticktickConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.move',
      args: { taskId: 'task_1', projectId: 'proj_2' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.ticktick.com/v2/task/task_1/move')
    expect(requestBody).toEqual({ projectId: 'proj_2' })
  })
})
