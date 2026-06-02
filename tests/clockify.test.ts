import { afterEach, describe, expect, it, vi } from 'vitest'
import { clockifyConnector } from '../src/connectors/adapters/clockify.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_clockify_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'clockify',
    label: 'Clockify test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'clockify_secret' },
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

describe('clockify adapter manifest', () => {
  it('classifies itself as the other category and exposes the clockify kind', () => {
    expect(clockifyConnector.manifest.kind).toBe('clockify')
    expect(clockifyConnector.manifest.category).toBe('other')
    expect(clockifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = clockifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the write surface: tasks, time entries, timers, projects', () => {
    const names = clockifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'task.create',
        'time.entry.create',
        'time.entry.update',
        'time.entry.delete',
        'timer.running.find',
        'task.find',
        'time.entry.find',
        'timer.start',
        'timer.stop',
        'project.create',
      ].sort(),
    )
    const reads = clockifyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clockifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['task.find', 'time.entry.find', 'timer.running.find'].sort())
    expect(mutations).toEqual(
      [
        'task.create',
        'time.entry.create',
        'time.entry.update',
        'time.entry.delete',
        'timer.start',
        'timer.stop',
        'project.create',
      ].sort(),
    )
  })

  it('marks every mutation as an external effect', () => {
    const mutations = clockifyConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const c of mutations) {
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('clockify time.entry.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the time entry resource on the workspace path with the bearer apiKey', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestAuth: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestAuth = (init?.headers as Record<string, string> | undefined)?.authorization
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'entry_42' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clockifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'time.entry.update',
      args: {
        workspaceId: 'ws_1',
        id: 'entry_42',
        start: '2026-01-01T09:00:00Z',
        end: '2026-01-01T10:00:00Z',
        description: 'edited',
        projectId: 'proj_1',
        taskId: 'task_1',
        billable: true,
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(requestUrl).toContain('/workspaces/ws_1/time-entries/entry_42')
    expect(requestUrl).toContain('api.clockify.me/api/v1')
    expect(requestAuth).toBe('Bearer clockify_secret')
    expect(requestBody).toMatchObject({
      start: '2026-01-01T09:00:00Z',
      end: '2026-01-01T10:00:00Z',
      description: 'edited',
      projectId: 'proj_1',
      taskId: 'task_1',
      billable: true,
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      clockifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'time.entry.update',
        args: {
          workspaceId: 'ws_1',
          id: 'entry_42',
          start: '2026-01-01T09:00:00Z',
          end: '2026-01-01T10:00:00Z',
          description: 'x',
          projectId: 'p',
          taskId: 't',
          billable: false,
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('clockify project.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /workspaces/{id}/projects with the project body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ id: 'proj_new' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clockifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'project.create',
      args: {
        workspaceId: 'ws_1',
        name: 'New Project',
        clientId: 'client_1',
        isPublic: false,
        billable: true,
        color: '#aabbcc',
        note: 'kickoff',
      },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toContain('/workspaces/ws_1/projects')
    expect(requestBody).toMatchObject({
      name: 'New Project',
      clientId: 'client_1',
      isPublic: false,
      billable: true,
      color: '#aabbcc',
      note: 'kickoff',
    })
  })
})

describe('clockify time.entry.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the workspace time entry path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await clockifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'time.entry.delete',
      args: { workspaceId: 'ws_1', id: 'entry_42' },
      idempotencyKey: 'k-3',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toContain('/workspaces/ws_1/time-entries/entry_42')
  })
})
