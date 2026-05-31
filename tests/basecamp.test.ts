import { afterEach, describe, expect, it, vi } from 'vitest'
import { basecampConnector } from '../src/connectors/adapters/basecamp.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_basecamp',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'basecamp',
  label: 'Basecamp (Acme)',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: { accountBaseUrl: 'https://3.basecampapi.com/9999999' },
  credentials: { kind: 'oauth2', accessToken: 'token_basecamp' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('basecamp adapter manifest', () => {
  it('classifies itself with the expected kind, category, and consistency model', () => {
    expect(basecampConnector.manifest.kind).toBe('basecamp')
    expect(basecampConnector.manifest.category).toBe('other')
    expect(basecampConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares Basecamp 3 launchpad OAuth2 endpoints + env-var names', () => {
    const auth = basecampConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://launchpad.37signals.com/authorization/new')
    expect(auth.tokenUrl).toBe('https://launchpad.37signals.com/authorization/token')
    expect(auth.clientIdEnv).toBe('BASECAMP_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('BASECAMP_OAUTH_CLIENT_SECRET')
    // Basecamp's launchpad consent is all-or-nothing — no granular scopes.
    expect(auth.scopes).toEqual([])
  })

  it('exposes the core Basecamp 3 action pack split between reads and mutations', () => {
    const names = basecampConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('projects.list')
    expect(names).toContain('projects.get')
    expect(names).toContain('projects.create')
    expect(names).toContain('message_board.messages.list')
    expect(names).toContain('message_board.messages.create')
    expect(names).toContain('todos.list')
    expect(names).toContain('todos.create')
    expect(names).toContain('todos.update')
    expect(names).toContain('todos.complete')
    expect(names).toContain('todos.uncomplete')
    expect(names).toContain('comments.create')
    expect(names).toContain('campfire.lines.create')
    expect(names).toContain('people.list')

    const mutations = basecampConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('todos.create')
    expect(mutations).toContain('todos.update')
    expect(mutations).toContain('todos.complete')
    expect(mutations).toContain('campfire.lines.create')
  })
})

describe('basecamp adapter execution', () => {
  it('routes projects.list to the per-account base URL with bearer auth + user-agent', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify([{ id: 1234, name: 'Demo Project' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'projects.list',
      args: { page: 2 },
      idempotencyKey: 'idem_list',
    }
    const result = await basecampConnector.executeRead!(invocation)

    expect(Array.isArray(result.data)).toBe(true)
    const call = fetchMock.mock.calls[0]!
    const url = String(call[0])
    expect(url.startsWith('https://3.basecampapi.com/9999999/projects.json')).toBe(true)
    expect(url).toContain('page=2')
    const headers = call[1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_basecamp')
    expect(headers['user-agent']).toBe('Tangle Hub (https://tangle.tools)')
  })

  it('POSTs todos.create to the bucketed todolist endpoint with snake_case body keys', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: 5555, content: 'Ship the basecamp adapter' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'todos.create',
      args: {
        projectId: '1234',
        todolistId: '7777',
        content: 'Ship the basecamp adapter',
        assignee_ids: [42, 43],
        due_on: '2026-06-01',
      },
      idempotencyKey: 'idem_create',
    }
    const result = await basecampConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0])).toBe(
      'https://3.basecampapi.com/9999999/buckets/1234/todolists/7777/todos.json',
    )
    expect(call[1]!.method).toBe('POST')
    const body = JSON.parse(String(call[1]!.body)) as {
      content: string
      assignee_ids: number[]
      due_on: string
    }
    expect(body.content).toBe('Ship the basecamp adapter')
    expect(body.assignee_ids).toEqual([42, 43])
    expect(body.due_on).toBe('2026-06-01')
  })

  it('throws CredentialsExpired when launchpad rejects the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'projects.get',
      args: { projectId: '1234' },
      idempotencyKey: 'idem_get',
    }
    await expect(basecampConnector.executeRead!(invocation)).rejects.toMatchObject({
      name: 'CredentialsExpired',
    })
  })
})
