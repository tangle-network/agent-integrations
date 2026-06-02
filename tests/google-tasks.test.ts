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
    expect(String(requestUrl)).toBe('https://tasks.googleapis.com/tasks/v1/users/@me/lists/list_1/tasks/task_42')
    expect(requestBody).toMatchObject({ status: 'completed' })
    expect(result.status).toBe('committed')
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
