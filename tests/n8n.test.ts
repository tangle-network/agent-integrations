import { afterEach, describe, expect, it, vi } from 'vitest'
import { n8nConnector } from '../src/connectors/adapters/n8n.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_n8n_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'n8n',
    label: 'n8n test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instanceUrl: 'https://workspace.app.n8n.cloud' },
    credentials: { kind: 'api-key', apiKey: 'n8n_secret' },
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

describe('n8n adapter manifest', () => {
  it('exposes the n8n kind in the other category', () => {
    expect(n8nConnector.manifest.kind).toBe('n8n')
    expect(n8nConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (X-N8N-API-KEY header)', () => {
    expect(n8nConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers workflows, executions, and webhook trigger surfaces plus write-side ops', () => {
    const names = n8nConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.list',
        'workflows.get',
        'workflows.activate',
        'workflows.deactivate',
        'workflows.create',
        'workflows.update',
        'workflows.delete',
        'executions.list',
        'executions.get',
        'executions.delete',
        'executions.stop',
        'webhooks.trigger',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of n8nConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('n8n workflows.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the workflow definition to /api/v1/workflows', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: { name?: string } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'wf_created', name: 'New WF' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const definition = { name: 'New WF', nodes: [], connections: {} }
    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.create',
      args: { definition },
      idempotencyKey: 'k-create',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/api/v1/workflows')
    expect(capturedBody).toEqual(definition)
    expect(result.status).toBe('committed')
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      n8nConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflows.create',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: definition/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      n8nConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflows.create',
        args: { definition: { name: 'x', nodes: [], connections: {} } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('n8n workflows.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the new definition to /api/v1/workflows/{workflowId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'wf_1', name: 'Renamed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const definition = { name: 'Renamed', nodes: [], connections: {} }
    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.update',
      args: { workflowId: 'wf_1', definition },
      idempotencyKey: 'k-update',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toContain('/api/v1/workflows/wf_1')
    expect(capturedBody).toEqual(definition)
    expect(result.status).toBe('committed')
  })
})

describe('n8n workflows.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/workflows/{workflowId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ id: 'wf_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.delete',
      args: { workflowId: 'wf_1' },
      idempotencyKey: 'k-del',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/api/v1/workflows/wf_1')
    expect(result.status).toBe('committed')
  })

  it('handles a 204 No Content response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    )
    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.delete',
      args: { workflowId: 'wf_1' },
      idempotencyKey: 'k-del-204',
    })
    expect(result.status).toBe('committed')
  })
})

describe('n8n executions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/executions/{executionId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ id: 'exec_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'executions.delete',
      args: { executionId: 'exec_1' },
      idempotencyKey: 'k-exec-del',
    })

    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/api/v1/executions/exec_1')
    expect(result.status).toBe('committed')
  })
})

describe('n8n executions.stop', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/executions/{executionId}/stop', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ id: 'exec_1', stoppedAt: 'now' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await n8nConnector.executeMutation!({
      source: source(),
      capabilityName: 'executions.stop',
      args: { executionId: 'exec_1' },
      idempotencyKey: 'k-stop',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/api/v1/executions/exec_1/stop')
    expect(result.status).toBe('committed')
  })

  it('rejects missing executionId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      n8nConnector.executeMutation!({
        source: source(),
        capabilityName: 'executions.stop',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: executionId/)
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      n8nConnector.executeMutation!({
        source: source(),
        capabilityName: 'executions.stop',
        args: { executionId: 'exec_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
