import { afterEach, describe, expect, it, vi } from 'vitest'
import { togglTrackConnector } from '../src/connectors/adapters/toggl-track.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_toggl_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'toggl-track',
    label: 'toggl test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'toggl_secret' },
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

describe('toggl-track adapter manifest', () => {
  it('classifies itself as the other category and exposes the toggl-track kind', () => {
    expect(togglTrackConnector.manifest.kind).toBe('toggl-track')
    expect(togglTrackConnector.manifest.category).toBe('other')
    expect(togglTrackConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Toggl Track-specific hint', () => {
    const auth = togglTrackConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Toggl Track/i)
  })

  it('covers clients, projects, tasks, tags, time entries, and user capabilities', () => {
    const names = togglTrackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('clients.create')
    expect(names).toContain('clients.find')
    expect(names).toContain('clients.update')
    expect(names).toContain('clients.delete')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.find')
    expect(names).toContain('projects.update')
    expect(names).toContain('projects.delete')
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.find')
    expect(names).toContain('tags.create')
    expect(names).toContain('tags.find')
    expect(names).toContain('time-entries.create')
    expect(names).toContain('time-entries.start')
    expect(names).toContain('time-entries.stop')
    expect(names).toContain('time-entries.find')
    expect(names).toContain('time-entries.delete')
    expect(names).toContain('user.find')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = togglTrackConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('clients.create')
    expect(mutations).toContain('clients.update')
    expect(mutations).toContain('clients.delete')
    expect(mutations).toContain('projects.create')
    expect(mutations).toContain('projects.update')
    expect(mutations).toContain('projects.delete')
    expect(mutations).toContain('tasks.create')
    expect(mutations).toContain('tags.create')
    expect(mutations).toContain('time-entries.create')
    expect(mutations).toContain('time-entries.start')
    expect(mutations).toContain('time-entries.stop')
    expect(mutations).toContain('time-entries.delete')
  })

  it('marks read-only operations as read', () => {
    const reads = togglTrackConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('clients.find')
    expect(reads).toContain('projects.find')
    expect(reads).toContain('tasks.find')
    expect(reads).toContain('tags.find')
    expect(reads).toContain('time-entries.find')
    expect(reads).toContain('user.find')
  })

  it('marks new write-side capabilities as native-idempotency external-effect', () => {
    for (const name of [
      'clients.update',
      'clients.delete',
      'projects.update',
      'projects.delete',
      'time-entries.delete',
    ]) {
      const cap = togglTrackConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('toggl-track clients.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /workspaces/{wid}/clients/{cid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 99, name: 'Renamed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await togglTrackConnector.executeMutation!({
      source: source(),
      capabilityName: 'clients.update',
      args: { workspace_id: 42, client_id: 99, name: 'Renamed' },
      idempotencyKey: 'k-cu',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v9/workspaces/42/clients/99')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      togglTrackConnector.executeMutation!({
        source: source(),
        capabilityName: 'clients.update',
        args: { workspace_id: 42, client_id: 99 },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('toggl-track clients.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /workspaces/{wid}/clients/{cid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await togglTrackConnector.executeMutation!({
      source: source(),
      capabilityName: 'clients.delete',
      args: { workspace_id: 42, client_id: 99 },
      idempotencyKey: 'k-cd',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v9/workspaces/42/clients/99')
  })
})

describe('toggl-track projects.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /workspaces/{wid}/projects/{pid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 7, name: 'New name' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await togglTrackConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.update',
      args: { workspace_id: 42, project_id: 7, name: 'New name' },
      idempotencyKey: 'k-pu',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v9/workspaces/42/projects/7')
  })
})

describe('toggl-track projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /workspaces/{wid}/projects/{pid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await togglTrackConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { workspace_id: 42, project_id: 7 },
      idempotencyKey: 'k-pd',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v9/workspaces/42/projects/7')
  })
})

describe('toggl-track time-entries.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /workspaces/{wid}/time_entries/{teid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await togglTrackConnector.executeMutation!({
      source: source(),
      capabilityName: 'time-entries.delete',
      args: { workspace_id: 42, time_entry_id: 123 },
      idempotencyKey: 'k-ted',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v9/workspaces/42/time_entries/123')
  })
})
