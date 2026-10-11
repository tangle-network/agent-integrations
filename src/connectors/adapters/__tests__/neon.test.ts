import { afterEach, describe, expect, it, vi } from 'vitest'
import { neonConnector } from '../neon.js'
import type { ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_neon',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'neon',
  label: 'Neon',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'neon-key' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('neon adapter', () => {
  it('declares an api-key database connector against api.neon.tech', () => {
    const manifest = neonConnector.manifest
    expect(manifest.kind).toBe('neon')
    expect(manifest.auth.kind).toBe('api-key')
    expect(manifest.category).toBe('database')
    
    const names = manifest.capabilities.map((c) => c.name)
    for (const expected of [
      'projects.list',
      'projects.create',
      'projects.update',
      'projects.delete',
      'branches.list',
      'branches.get',
      'branches.create',
      'branches.delete',
      'branches.restore',
      'branches.set_primary',
      'endpoints.list',
      'endpoints.create',
      'endpoints.update',
      'endpoints.delete',
      'operations.list',
      'operations.get',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('lists projects with bearer auth and only set query params', async () => {
    const fetchMock = mockFetch({ projects: [] })
    const result = await neonConnector.executeRead!({
      source,
      capabilityName: 'projects.list',
      args: { limit: 25, search: 'sandbox' },
      idempotencyKey: 'op_0',
    })
    expect(result).toBeDefined()

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.hostname).toBe('api.neon.tech')
    expect(url.pathname).toBe('/v2/projects')
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('search')).toBe('sandbox')
    expect(url.searchParams.has('cursor')).toBe(false)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer neon-key')
    expect(init.method).toBe('GET')
  })

  it('creates a branch with a nested body and drops unset optional fields', async () => {
    const fetchMock = mockFetch({ branch: { id: 'br_new' } })
    await neonConnector.executeMutation!({
      source,
      capabilityName: 'branches.create',
      args: { project_id: 'shiny-math-123', name: 'agent-experiment' },
      idempotencyKey: 'op_1',
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/projects/shiny-math-123/branches')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ branch: { name: 'agent-experiment' } })
  })

  it('restores a branch carrying both source selectors when supplied', async () => {
    const fetchMock = mockFetch({ branch: { id: 'br_main' }, operations: [] })
    await neonConnector.executeMutation!({
      source,
      capabilityName: 'branches.restore',
      args: {
        project_id: 'shiny-math-123',
        branch_id: 'br_main',
        source_branch_id: 'br_experiment',
        preserve_under_name: 'before-restore',
      },
      idempotencyKey: 'op_2',
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/projects/shiny-math-123/branches/br_main/restore')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.source_branch_id).toBe('br_experiment')
    expect(body.preserve_under_name).toBe('before-restore')
    expect(body.source_timestamp).toBeUndefined()
  })

  it('sets a branch primary via the set_as_primary route with an empty body', async () => {
    const fetchMock = mockFetch({ branch: { id: 'br_experiment' } })
    await neonConnector.executeMutation!({
      source,
      capabilityName: 'branches.set_primary',
      args: { project_id: 'shiny-math-123', branch_id: 'br_experiment' },
      idempotencyKey: 'op_3',
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/projects/shiny-math-123/branches/br_experiment/set_as_primary')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('updates an endpoint with a nested patch body', async () => {
    const fetchMock = mockFetch({ endpoint: { id: 'ep_late-rain-1' } })
    await neonConnector.executeMutation!({
      source,
      capabilityName: 'endpoints.update',
      args: {
        project_id: 'shiny-math-123',
        endpoint_id: 'ep_late-rain-1',
        suspend_timeout_seconds: 300,
        pooler_enabled: true,
      },
      idempotencyKey: 'op_4',
    })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/projects/shiny-math-123/endpoints/ep_late-rain-1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: { suspend_timeout_seconds: 300, pooler_enabled: true },
    })
  })

  it('reads an operation by id through path interpolation', async () => {
    const fetchMock = mockFetch({ operation: { id: 'op_polite-math', status: 'finished' } })
    const result = await neonConnector.executeRead!({
      source,
      capabilityName: 'operations.get',
      args: { project_id: 'shiny-math-123', operation_id: 'op_polite-math' },
      idempotencyKey: 'op_5',
    })
    expect(result).toBeDefined()

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/projects/shiny-math-123/operations/op_polite-math')
  })

  it('probes the key with GET /v2/users/me', async () => {
    const fetchMock = mockFetch({ user: { id: 'user_1' } })
    const outcome = await neonConnector.test!(source)
    expect(outcome).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/users/me')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer neon-key')
  })

  it('classifies a 401 as an expired credential, not a provider fault', async () => {
    mockFetch({ message: 'The request could not be authorized' }, { status: 401 })
    const outcome = await neonConnector.test!(source)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/credential/i)
  })
})
