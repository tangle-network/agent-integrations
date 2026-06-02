import { afterEach, describe, expect, it, vi } from 'vitest'
import { retableConnector } from '../src/connectors/adapters/retable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_retable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'retable',
    label: 'Retable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'retable_secret' },
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

describe('retable adapter manifest', () => {
  it('classifies itself as the doc category and exposes the retable kind', () => {
    expect(retableConnector.manifest.kind).toBe('retable')
    expect(retableConnector.manifest.category).toBe('doc')
    expect(retableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = retableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full action set (workspaces, projects, retables, records) including deletes', () => {
    const names = retableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workspaces.list',
        'workspaces.create',
        'workspaces.delete',
        'projects.list',
        'projects.create',
        'projects.delete',
        'retables.list',
        'retables.delete',
        'records.create',
        'records.get',
        'records.list',
        'records.update',
        'records.delete',
      ].sort(),
    )
    const reads = retableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = retableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['workspaces.list', 'projects.list', 'retables.list', 'records.get', 'records.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'workspaces.create',
        'workspaces.delete',
        'projects.create',
        'projects.delete',
        'retables.delete',
        'records.create',
        'records.update',
        'records.delete',
      ].sort(),
    )
  })

  it('marks every new delete mutation as native-idempotency + externalEffect', () => {
    const deletes = retableConnector.manifest.capabilities.filter(
      (c) => c.class === 'mutation' && c.name.endsWith('.delete'),
    )
    expect(deletes.length).toBe(4)
    for (const c of deletes) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('retable delete mutations', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs records at /projects/{projectId}/retables/{retableId}/records/{recordId}', async () => {
    let url: string | undefined
    let method: string | undefined
    let body: BodyInit | null | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      method = init?.method
      body = init?.body
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await retableConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.delete',
      args: { projectId: 'p_1', retableId: 'r_2', recordId: 'rec_3' },
      idempotencyKey: 'k-rec-del',
    })
    expect(result.status).toBe('committed')
    expect(method).toBe('DELETE')
    expect(body).toBeUndefined()
    expect(url).toContain('/projects/p_1/retables/r_2/records/rec_3')
  })

  it('DELETEs projects at /projects/{projectId}', async () => {
    let url: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await retableConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { projectId: 'p_42' },
      idempotencyKey: 'k-proj-del',
    })
    expect(result.status).toBe('committed')
    expect(url).toMatch(/\/projects\/p_42$/)
  })

  it('DELETEs workspaces at /workspaces/{workspaceId}', async () => {
    let url: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await retableConnector.executeMutation!({
      source: source(),
      capabilityName: 'workspaces.delete',
      args: { workspaceId: 'w_5' },
      idempotencyKey: 'k-ws-del',
    })
    expect(result.status).toBe('committed')
    expect(url).toMatch(/\/workspaces\/w_5$/)
  })

  it('DELETEs retables at /projects/{projectId}/retables/{retableId}', async () => {
    let url: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await retableConnector.executeMutation!({
      source: source(),
      capabilityName: 'retables.delete',
      args: { projectId: 'p_1', retableId: 'r_2' },
      idempotencyKey: 'k-rt-del',
    })
    expect(result.status).toBe('committed')
    expect(url).toMatch(/\/projects\/p_1\/retables\/r_2$/)
  })

  it('surfaces CredentialsExpired on 401 for any delete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauth', { status: 401 })))
    await expect(
      retableConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.delete',
        args: { projectId: 'p_1', retableId: 'r_2', recordId: 'rec_3' },
        idempotencyKey: 'k-rec-del-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
