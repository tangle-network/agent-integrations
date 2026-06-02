import { afterEach, describe, expect, it, vi } from 'vitest'
import { niftyConnector } from '../src/connectors/adapters/nifty.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_nifty_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'nifty',
    label: 'Drew Nifty',
    consistencyModel: 'authoritative',
    scopes: ['tasks:write', 'tasks:read'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
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

describe('nifty adapter manifest', () => {
  it('classifies itself as the doc category and exposes the nifty kind', () => {
    expect(niftyConnector.manifest.kind).toBe('nifty')
    expect(niftyConnector.manifest.category).toBe('doc')
    expect(niftyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = niftyConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: create + update tasks and create comments', () => {
    const names = niftyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['comments.create', 'tasks.create', 'tasks.update'])
    const mutations = niftyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['comments.create', 'tasks.create', 'tasks.update'])
  })

  it('declares native-idempotency CAS and tasks:write scope on every mutation', () => {
    for (const cap of niftyConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
      expect(cap.requiredScopes).toEqual(['tasks:write'])
    }
  })
})

describe('nifty adapter — tasks.update', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs to /tasks/{taskId} and returns the updated task', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        id: 'task_123',
        name: 'Updated title',
        status: 'in_progress',
        milestone_id: 'm_42',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await niftyConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.update',
      args: {
        taskId: 'task_123',
        name: 'Updated title',
        milestone_id: 'm_42',
        assignee_ids: ['u_1', 'u_2'],
        status: 'in_progress',
      },
      idempotencyKey: 'idemp-update-1',
    })

    expect(calledMethod).toBe('PUT')
    expect(calledUrl).toBe('https://api.nifty.com/v1/tasks/task_123')
    expect(calledBody).toMatchObject({
      taskId: 'task_123',
      name: 'Updated title',
      milestone_id: 'm_42',
      assignee_ids: ['u_1', 'u_2'],
      status: 'in_progress',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.data).toMatchObject({ id: 'task_123', name: 'Updated title' })
      expect(typeof result.committedAt).toBe('number')
    }
  })

  it('rejects when taskId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.update',
        args: { name: 'no id provided' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/taskId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 })),
    )
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.update',
        args: { taskId: 'task_123', name: 'whatever' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 })),
    )
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'tasks.update',
        args: { taskId: 'task_123', name: 'whatever' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('nifty adapter — comments.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /comments with object_type=Task and the required fields', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        id: 'comment_42',
        object_type: 'Task',
        object_id: 'task_123',
        content: 'looks good',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await niftyConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: { object_id: 'task_123', content: 'looks good' },
      idempotencyKey: 'idemp-comment-1',
    })

    expect(calledMethod).toBe('POST')
    expect(calledUrl).toBe('https://api.nifty.com/v1/comments')
    expect(calledBody).toEqual({
      object_type: 'Task',
      object_id: 'task_123',
      content: 'looks good',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.data).toMatchObject({
        id: 'comment_42',
        object_type: 'Task',
        object_id: 'task_123',
      })
    }
  })

  it('rejects when object_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'comments.create',
        args: { content: 'orphan comment' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/object_id/)
  })

  it('rejects when content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'comments.create',
        args: { object_id: 'task_123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/content/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 })),
    )
    await expect(
      niftyConnector.executeMutation!({
        source: source(),
        capabilityName: 'comments.create',
        args: { object_id: 'task_123', content: 'nope' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
