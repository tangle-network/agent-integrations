import { afterEach, describe, expect, it, vi } from 'vitest'
import { browseAiConnector } from '../src/connectors/adapters/browse-ai.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_browse_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'browse-ai',
    label: 'Browse AI',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'k_test_123' },
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

describe('browse-ai adapter manifest', () => {
  it('exposes the browse-ai kind and other category', () => {
    expect(browseAiConnector.manifest.kind).toBe('browse-ai')
    expect(browseAiConnector.manifest.category).toBe('other')
    expect(browseAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = browseAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers original actions plus capturedLists.get + tasks.list reads', () => {
    const names = browseAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'capturedLists.get',
      'get.task.details',
      'list.robots',
      'run.robot',
      'tasks.list',
    ])
    const reads = browseAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = browseAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['capturedLists.get', 'get.task.details', 'list.robots', 'tasks.list'])
    expect(mutations).toEqual(['run.robot'])
  })
})

describe('browse-ai capturedLists.get', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /robots/{robotId}/tasks/{taskId}/captured-lists/{capturedListId} with pagination + bearer auth', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledAuthHeader = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? 'GET'
      const headers = init?.headers as Record<string, string> | undefined
      calledAuthHeader = headers?.authorization ?? ''
      return jsonResponse({
        capturedList: {
          id: 'cl_1',
          rows: [{ name: 'Ada', price: '$9.99' }, { name: 'Lin', price: '$12.50' }],
        },
        totalRowCount: 2,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await browseAiConnector.executeRead!({
      source: source(),
      capabilityName: 'capturedLists.get',
      args: { robotId: 'r1', taskId: 't1', capturedListId: 'cl_1', pageSize: 50, pageNumber: 2 },
      idempotencyKey: 'k1',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toContain('/robots/r1/tasks/t1/captured-lists/cl_1')
    expect(calledUrl).toContain('pageSize=50')
    expect(calledUrl).toContain('pageNumber=2')
    expect(calledAuthHeader).toBe('Bearer k_test_123')
    const data = result.data as { capturedList: { id: string; rows: Array<{ name: string }> }; totalRowCount: number }
    expect(data.capturedList.id).toBe('cl_1')
    expect(data.capturedList.rows).toHaveLength(2)
    expect(data.totalRowCount).toBe(2)
  })

  it('omits pageSize/pageNumber when not provided', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ capturedList: { id: 'cl_1', rows: [] }, totalRowCount: 0 })
    }))
    await browseAiConnector.executeRead!({
      source: source(),
      capabilityName: 'capturedLists.get',
      args: { robotId: 'r1', taskId: 't1', capturedListId: 'cl_1' },
      idempotencyKey: 'k1',
    })
    expect(calledUrl).not.toContain('pageSize=')
    expect(calledUrl).not.toContain('pageNumber=')
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'capturedLists.get',
        args: { taskId: 't1', capturedListId: 'cl_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: robotId/)
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'capturedLists.get',
        args: { robotId: 'r1', capturedListId: 'cl_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: taskId/)
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'capturedLists.get',
        args: { robotId: 'r1', taskId: 't1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: capturedListId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'capturedLists.get',
        args: { robotId: 'r1', taskId: 't1', capturedListId: 'cl_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'capturedLists.get',
        args: { robotId: 'r1', taskId: 't1', capturedListId: 'cl_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('browse-ai tasks.list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /robots/{robotId}/tasks with optional filters and bearer auth', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledAuthHeader = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? 'GET'
      const headers = init?.headers as Record<string, string> | undefined
      calledAuthHeader = headers?.authorization ?? ''
      return jsonResponse({
        robotTasks: {
          items: [
            { id: 't1', status: 'successful' },
            { id: 't2', status: 'failed' },
          ],
          totalCount: 2,
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await browseAiConnector.executeRead!({
      source: source(),
      capabilityName: 'tasks.list',
      args: {
        robotId: 'r1',
        sort: '-createdAt',
        fromDate: '2025-01-01',
        toDate: '2025-12-31',
        status: 'successful',
      },
      idempotencyKey: 'k1',
    })
    expect(calledMethod).toBe('GET')
    expect(calledUrl).toContain('/robots/r1/tasks')
    expect(calledUrl).toContain('sort=-createdAt')
    expect(calledUrl).toContain('fromDate=2025-01-01')
    expect(calledUrl).toContain('toDate=2025-12-31')
    expect(calledUrl).toContain('status=successful')
    expect(calledAuthHeader).toBe('Bearer k_test_123')
    const data = result.data as { robotTasks: { items: Array<{ id: string; status: string }>; totalCount: number } }
    expect(data.robotTasks.items).toHaveLength(2)
    expect(data.robotTasks.items[0]).toMatchObject({ id: 't1', status: 'successful' })
    expect(data.robotTasks.totalCount).toBe(2)
  })

  it('omits optional filters when not provided', async () => {
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({ robotTasks: { items: [], totalCount: 0 } })
    }))
    await browseAiConnector.executeRead!({
      source: source(),
      capabilityName: 'tasks.list',
      args: { robotId: 'r1' },
      idempotencyKey: 'k1',
    })
    expect(calledUrl).toContain('/robots/r1/tasks')
    expect(calledUrl).not.toContain('sort=')
    expect(calledUrl).not.toContain('fromDate=')
    expect(calledUrl).not.toContain('toDate=')
    expect(calledUrl).not.toContain('status=')
  })

  it('rejects missing required robotId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'tasks.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: robotId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'tasks.list',
        args: { robotId: 'r1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
    await expect(
      browseAiConnector.executeRead!({
        source: source(),
        capabilityName: 'tasks.list',
        args: { robotId: 'r1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
