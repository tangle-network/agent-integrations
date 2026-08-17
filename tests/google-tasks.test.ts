import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleTasksConnector } from '../src/connectors/adapters/google-tasks.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const baseSource: ResolvedDataSource = {
  id: 'src_google_tasks',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'google-tasks',
  label: 'Google Tasks',
  consistencyModel: 'authoritative',
  scopes: ['https://www.googleapis.com/auth/tasks'],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
  status: 'active',
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('google-tasks adapter manifest', () => {
  it('classifies itself as kind=google-tasks, category=doc, oauth2 auth', () => {
    expect(googleTasksConnector.manifest.kind).toBe('google-tasks')
    expect(googleTasksConnector.manifest.category).toBe('doc')
    expect(googleTasksConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(googleTasksConnector.manifest.auth.kind).toBe('oauth2')
    if (googleTasksConnector.manifest.auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(googleTasksConnector.manifest.auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(googleTasksConnector.manifest.auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
  })

  it('declares capabilities covering tasklists, tasks, read and write operations', () => {
    const names = googleTasksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'lists.create',
      'tasklists.get',
      'tasklists.list',
      'tasks.complete',
      'tasks.create',
      'tasks.delete',
      'tasks.get',
      'tasks.list',
      'tasks.update',
    ])
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['tasks.complete', 'lists.create']) {
      const cap = googleTasksConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('google-tasks tasks.complete', () => {
  it('PATCHes the task with status=completed', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'task_42', status: 'completed' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await googleTasksConnector.executeMutation!({
      source: baseSource,
      capabilityName: 'tasks.complete',
      args: { tasklistId: 'list_1', taskId: 'task_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://tasks.googleapis.com/tasks/v1/lists/list_1/tasks/task_42')
    expect(requestBody).toMatchObject({ status: 'completed' })
    expect(result.status).toBe('committed')
  })
})

describe('google-tasks task operations', () => {
  it('uses the Google Tasks /lists path and maps insertion query/body fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'task_42', title: 'Production proof' })
    }))

    await googleTasksConnector.executeMutation!({
      source: baseSource,
      capabilityName: 'tasks.create',
      args: {
        tasklistId: 'list_1',
        title: 'Production proof',
        dueDate: '2026-07-31T00:00:00.000Z',
        parent: 'parent_1',
        previous: 'task_41',
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe(
      'https://tasks.googleapis.com/tasks/v1/lists/list_1/tasks?parent=parent_1&previous=task_41',
    )
    expect(requestBody).toEqual({
      title: 'Production proof',
      due: '2026-07-31T00:00:00.000Z',
    })
  })

  it('lists tasks from /lists and forwards supported filters', async () => {
    let requestUrl: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ items: [] })
    }))

    await googleTasksConnector.executeRead!({
      source: baseSource,
      capabilityName: 'tasks.list',
      idempotencyKey: 'k-1',
      args: {
        tasklistId: 'list_1',
        maxResults: 50,
        showCompleted: false,
        showAssigned: true,
        updatedMin: '2026-07-01T00:00:00.000Z',
      },
    })

    const url = new URL(String(requestUrl))
    expect(url.pathname).toBe('/tasks/v1/lists/list_1/tasks')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      maxResults: '50',
      showCompleted: 'false',
      showAssigned: 'true',
      updatedMin: '2026-07-01T00:00:00.000Z',
    })
  })

  it.each([
    ['tasks.get', 'GET'],
    ['tasks.update', 'PATCH'],
    ['tasks.delete', 'DELETE'],
  ] as const)('%s targets /lists/{tasklist}/tasks/{task}', async (capabilityName, method) => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return method === 'DELETE' ? new Response(null, { status: 204 }) : jsonResponse({ id: 'task_42' })
    }))

    const invocation = {
      source: baseSource,
      capabilityName,
      idempotencyKey: 'k-1',
      args: { tasklistId: 'list_1', taskId: 'task_42', title: 'Updated' },
    }
    if (capabilityName === 'tasks.get') {
      await googleTasksConnector.executeRead!(invocation)
    } else {
      await googleTasksConnector.executeMutation!(invocation)
    }

    expect(requestMethod).toBe(method)
    expect(String(requestUrl)).toBe('https://tasks.googleapis.com/tasks/v1/lists/list_1/tasks/task_42')
  })
})

describe('google-tasks lists.create', () => {
  it('POSTs the title to /users/@me/lists', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'list_99', title: 'Groceries' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await googleTasksConnector.executeMutation!({
      source: baseSource,
      capabilityName: 'lists.create',
      args: { title: 'Groceries' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://tasks.googleapis.com/tasks/v1/users/@me/lists')
    expect(requestBody).toMatchObject({ title: 'Groceries' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      googleTasksConnector.executeMutation!({
        source: baseSource,
        capabilityName: 'lists.create',
        args: { title: 'Groceries' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
