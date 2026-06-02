import { afterEach, describe, expect, it, vi } from 'vitest'
import { todoistConnector } from '../src/connectors/adapters/todoist.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_todoist_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'todoist',
    label: 'todoist test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'todoist_secret' },
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

describe('todoist adapter manifest', () => {
  it('classifies itself as the doc category and exposes the todoist kind', () => {
    expect(todoistConnector.manifest.kind).toBe('todoist')
    expect(todoistConnector.manifest.category).toBe('doc')
    expect(todoistConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth', () => {
    const auth = todoistConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers tasks, projects, comments, and labels capabilities', () => {
    const names = todoistConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.update')
    expect(names).toContain('tasks.get')
    expect(names).toContain('tasks.list')
    expect(names).toContain('tasks.complete')
    expect(names).toContain('tasks.delete')
    expect(names).toContain('projects.list')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.delete')
    expect(names).toContain('comments.create')
    expect(names).toContain('labels.create')
  })

  it('marks new write-side capabilities as native-idempotency external-effect', () => {
    for (const name of ['projects.create', 'projects.delete', 'comments.create', 'labels.create']) {
      const cap = todoistConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('todoist projects.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /rest/v2/projects with the project name', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'project_new', name: 'Launch plan' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await todoistConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.create',
      args: { name: 'Launch plan' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/rest/v2/projects')
    expect(requestBody).toContain('Launch plan')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      todoistConnector.executeMutation!({
        source: source(),
        capabilityName: 'projects.create',
        args: { name: 'Launch plan' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('todoist projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /rest/v2/projects/{project_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await todoistConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { project_id: 'project_xyz' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/rest/v2/projects/project_xyz')
  })
})

describe('todoist comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /rest/v2/comments with the comment content', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'comment_new', content: 'looks good' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await todoistConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: { content: 'looks good', task_id: 'task_abc' },
      idempotencyKey: 'k-3',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/rest/v2/comments')
    expect(requestBody).toContain('looks good')
  })
})

describe('todoist labels.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /rest/v2/labels with the label name', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'label_new', name: 'urgent' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await todoistConnector.executeMutation!({
      source: source(),
      capabilityName: 'labels.create',
      args: { name: 'urgent' },
      idempotencyKey: 'k-4',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/rest/v2/labels')
    expect(requestBody).toContain('urgent')
  })
})
