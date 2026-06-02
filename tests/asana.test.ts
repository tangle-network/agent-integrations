import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asanaConnector,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_asana_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'asana',
    label: 'Drew Asana',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'pat-xxx',
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

describe('asana adapter', () => {
  const adapter = asanaConnector

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes tasks.addComment and tasks.complete as mutations', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tasks.addComment')
    expect(names).toContain('tasks.complete')
    const addComment = adapter.manifest.capabilities.find((c) => c.name === 'tasks.addComment')!
    const complete = adapter.manifest.capabilities.find((c) => c.name === 'tasks.complete')!
    expect(addComment.class).toBe('mutation')
    expect(complete.class).toBe('mutation')
    if (addComment.class === 'mutation') {
      expect(addComment.cas).toBe('native-idempotency')
      expect(addComment.externalEffect).toBe(true)
    }
    if (complete.class === 'mutation') {
      expect(complete.cas).toBe('native-idempotency')
      expect(complete.externalEffect).toBe(true)
    }
  })

  it('tasks.addComment POSTs a comment story to /tasks/{taskGid}/stories', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: { data?: { text?: string; type?: string } } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { gid: 'story-1', text: 'looks good', type: 'comment' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tasks.addComment',
      args: { taskGid: 'task-123', text: 'looks good' },
      idempotencyKey: 'idemp-comment-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('/tasks/task-123/stories')
    expect(capturedBody!.data).toEqual({ text: 'looks good', type: 'comment' })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.committedAt).toBeTypeOf('number')
      expect(result.idempotentReplay).toBe(false)
      expect((result.data as { data: { gid: string } }).data.gid).toBe('story-1')
    }
  })

  it('tasks.addComment rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tasks.addComment',
        args: { text: 'hello' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: taskGid/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tasks.addComment',
        args: { taskGid: 'task-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: text/)
  })

  it('tasks.addComment surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'unauthorized' }),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tasks.addComment',
        args: { taskGid: 'task-1', text: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('tasks.complete PUTs completed=true to /tasks/{taskGid}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: { data?: { completed?: boolean } } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ data: { gid: 'task-123', completed: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tasks.complete',
      args: { taskGid: 'task-123' },
      idempotencyKey: 'idemp-complete-1',
    })

    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toContain('/tasks/task-123')
    expect(capturedUrl).not.toContain('/stories')
    expect(capturedBody!.data).toEqual({ completed: true })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.committedAt).toBeTypeOf('number')
      expect(result.idempotentReplay).toBe(false)
      expect((result.data as { data: { completed: boolean } }).data.completed).toBe(true)
    }
  })

  it('tasks.complete rejects missing taskGid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tasks.complete',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: taskGid/)
  })

  it('tasks.complete surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'forbidden' }),
      text: async () => 'forbidden',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tasks.complete',
        args: { taskGid: 'task-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
