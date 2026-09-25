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
  it('uses the official API v1 OAuth scope', () => {
    const auth = todoistConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected OAuth2')
    expect(auth.scopes).toEqual(['data:read_write'])
    expect(auth.scopes).not.toEqual(expect.arrayContaining(['task:read', 'task:update']))
  })

  it('binds every capability to data:read_write', () => {
    for (const capability of todoistConnector.manifest.capabilities) {
      expect(capability.requiredScopes, capability.name).toEqual(['data:read_write'])
    }
  })
})

describe('todoist projects.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/projects with the project name', async () => {
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
    expect(String(requestUrl)).toContain('/api/v1/projects')
    expect(requestBody).toContain('Launch plan')
  })
})

describe('todoist projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/projects/{project_id}', async () => {
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
    expect(String(requestUrl)).toContain('/api/v1/projects/project_xyz')
  })
})

describe('todoist comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/comments with the comment content', async () => {
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
    expect(String(requestUrl)).toContain('/api/v1/comments')
    expect(requestBody).toContain('looks good')
  })
})

describe('todoist labels.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/labels with the label name', async () => {
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
    expect(String(requestUrl)).toContain('/api/v1/labels')
    expect(requestBody).toContain('urgent')
  })
})
