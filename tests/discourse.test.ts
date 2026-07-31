import { afterEach, describe, expect, it, vi } from 'vitest'
import { discourseConnector } from '../src/connectors/adapters/discourse.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_discourse_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'discourse',
    label: 'Discourse test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://community.example.com' },
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({ apiKey: 'discourse-secret', apiUsername: 'tangle-hub' }),
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

describe('Discourse adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes the deep community pack as an authoritative chat connector', () => {
    expect(discourseConnector.manifest).toMatchObject({
      kind: 'discourse',
      category: 'comms',
      defaultConsistencyModel: 'authoritative',
      auth: { kind: 'api-key' },
    })
    expect(discourseConnector.manifest.capabilities.map((capability) => capability.name).sort()).toEqual([
      'categories.create',
      'categories.list',
      'categories.update',
      'groups.get',
      'groups.list',
      'groups.members.add',
      'groups.members.list',
      'groups.members.remove',
      'moderation.users.suspend',
      'notifications.list',
      'notifications.mark-read',
      'posts.create',
      'posts.delete',
      'posts.get',
      'posts.update',
      'search.query',
      'tags.list',
      'topics.create',
      'topics.delete',
      'topics.get',
      'topics.latest',
      'topics.set-status',
      'topics.update',
      'users.get',
    ])
  })

  it('checks credentials with both required Discourse headers', async () => {
    let capturedUrl = ''
    let capturedHeaders = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = new Headers(init?.headers)
      return jsonResponse({ notifications: [] })
    }))

    await expect(discourseConnector.test!(source())).resolves.toEqual({ ok: true })
    expect(capturedUrl).toBe('https://community.example.com/notifications.json')
    expect(capturedHeaders.get('Api-Key')).toBe('discourse-secret')
    expect(capturedHeaders.get('Api-Username')).toBe('tangle-hub')
  })

  it('fails closed when the credential bundle is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(discourseConnector.executeRead!({
      source: source({ credentials: { kind: 'api-key', apiKey: '{"apiKey":"secret"}' } }),
      capabilityName: 'topics.latest',
      args: {},
      idempotencyKey: 'incomplete-credentials',
    })).rejects.toThrow(/missing apiUsername/)
  })

  it('lists latest topics with exact provider query names', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input)
      return jsonResponse({ topic_list: { topics: [] } })
    }))

    await discourseConnector.executeRead!({
      source: source(),
      capabilityName: 'topics.latest',
      args: { order: 'activity', ascending: true, perPage: 50 },
      idempotencyKey: 'latest',
    })

    expect(capturedUrl).toBe('https://community.example.com/latest.json?order=activity&ascending=true&per_page=50')
  })

  it('creates topics and omits unset optional fields', async () => {
    let capturedBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ id: 91, topic_id: 42 })
    }))

    const result = await discourseConnector.executeMutation!({
      source: source(),
      capabilityName: 'topics.create',
      args: { title: 'Launch notes', raw: 'The release is live.', categoryId: 8 },
      idempotencyKey: 'create-topic',
    })

    expect(capturedBody).toEqual({ title: 'Launch notes', raw: 'The release is live.', category: 8 })
    expect(result.status).toBe('committed')
  })

  it('uses provider-native post update and topic status request bodies', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? '',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return jsonResponse({ success: 'OK' })
    }))

    await discourseConnector.executeMutation!({
      source: source(),
      capabilityName: 'posts.update',
      args: { postId: 91, raw: 'Corrected body', editReason: 'Fix typo', bypassBump: true },
      idempotencyKey: 'edit-post',
    })
    await discourseConnector.executeMutation!({
      source: source(),
      capabilityName: 'topics.set-status',
      args: { topicId: 42, status: 'closed', enabled: true },
      idempotencyKey: 'close-topic',
    })

    expect(requests).toEqual([
      {
        url: 'https://community.example.com/posts/91.json',
        method: 'PUT',
        body: { post: { raw: 'Corrected body', edit_reason: 'Fix typo' }, bypass_bump: true },
      },
      {
        url: 'https://community.example.com/t/42/status.json',
        method: 'PUT',
        body: { status: 'closed', enabled: true },
      },
    ])
  })

  it('sends group removals as an explicit DELETE body', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ success: true })
    }))

    await discourseConnector.executeMutation!({
      source: source(),
      capabilityName: 'groups.members.remove',
      args: { groupId: 17, usernames: 'alice,bob' },
      idempotencyKey: 'remove-members',
    })

    expect(capturedUrl).toBe('https://community.example.com/groups/17/members.json')
    expect(capturedMethod).toBe('DELETE')
    expect(capturedBody).toEqual({ usernames: 'alice,bob' })
  })

  it('rejects non-public forum roots and redacts both credentials from errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      'Api-Key discourse-secret rejected for Api-Username tangle-hub',
      { status: 500 },
    )))

    await expect(discourseConnector.executeRead!({
      source: source(),
      capabilityName: 'groups.list',
      args: {},
      idempotencyKey: 'redaction',
    })).rejects.not.toThrow(/discourse-secret|tangle-hub/)

    await expect(discourseConnector.executeRead!({
      source: source({ metadata: { baseUrl: 'http://127.0.0.1:3000' } }),
      capabilityName: 'groups.list',
      args: {},
      idempotencyKey: 'private-host',
    })).rejects.toThrow(/public HTTPS endpoint/)
  })
})
