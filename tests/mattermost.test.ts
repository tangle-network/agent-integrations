import { afterEach, describe, expect, it, vi } from 'vitest'
import { mattermostConnector } from '../src/connectors/adapters/mattermost.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_mattermost_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'mattermost',
    label: 'Acme Workspace',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { workspaceUrl: 'https://acme.mattermost.com' },
    credentials: { kind: 'api-key', apiKey: 'bot-token-123' },
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mattermost adapter manifest', () => {
  it('exposes the mattermost kind and a comms-grade category', () => {
    expect(mattermostConnector.manifest.kind).toBe('mattermost')
    expect(mattermostConnector.manifest.category).toBe('comms')
    expect(mattermostConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the activepieces catalog', () => {
    const auth = mattermostConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers send + the post-write surface (update, delete, react)', () => {
    const names = mattermostConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['add_reaction', 'delete_post', 'send.message', 'update_post'])
    const mutations = mattermostConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['add_reaction', 'delete_post', 'send.message', 'update_post'])
    for (const cap of mattermostConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBe('native-idempotency')
        expect(cap.externalEffect).toBe(true)
      }
    }
  })
})

describe('mattermost update_post', () => {
  it('PUTs /api/v4/posts/{post_id} with the new message', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: { id?: string; message?: string } | null = null
    let capturedAuth = ''
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null
      capturedAuth = (init?.headers as Record<string, string>)?.authorization ?? ''
      return jsonResponse({
        id: 'post-1',
        message: 'updated text',
        edit_at: 1717200000000,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mattermostConnector.executeMutation!({
      source: source(),
      capabilityName: 'update_post',
      args: { post_id: 'post-1', message: 'updated text' },
      idempotencyKey: 'idemp-upd-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe('https://acme.mattermost.com/api/v4/posts/post-1')
    expect(capturedBody).toEqual({ id: 'post-1', message: 'updated text' })
    expect(capturedAuth).toBe('Bearer bot-token-123')
    if (result.status === 'committed') {
      expect(result.data).toMatchObject({ id: 'post-1', message: 'updated text' })
    }
  })

  it('throws when post_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'update_post',
        args: { message: 'no id' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: post_id/)
  })

  it('throws when message is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'update_post',
        args: { post_id: 'post-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: message/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'update_post',
        args: { post_id: 'post-1', message: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('mattermost delete_post', () => {
  it('DELETEs /api/v4/posts/{post_id} with no body', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: BodyInit | null | undefined
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body
      return jsonResponse({ status: 'OK' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mattermostConnector.executeMutation!({
      source: source(),
      capabilityName: 'delete_post',
      args: { post_id: 'post-42' },
      idempotencyKey: 'idemp-del-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://acme.mattermost.com/api/v4/posts/post-42')
    expect(capturedBody).toBeUndefined()
    if (result.status === 'committed') {
      expect(result.data).toEqual({ status: 'OK' })
    }
  })

  it('throws when post_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'delete_post',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: post_id/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'delete_post',
        args: { post_id: 'post-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('mattermost add_reaction', () => {
  it('POSTs /api/v4/reactions with the (user_id, post_id, emoji_name) triple', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: { user_id?: string; post_id?: string; emoji_name?: string } | null = null
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({
        user_id: 'user-1',
        post_id: 'post-1',
        emoji_name: 'thumbsup',
        create_at: 1717200000000,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mattermostConnector.executeMutation!({
      source: source(),
      capabilityName: 'add_reaction',
      args: { user_id: 'user-1', post_id: 'post-1', emoji_name: 'thumbsup' },
      idempotencyKey: 'idemp-react-1',
    })

    expect(result.status).toBe('committed')
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://acme.mattermost.com/api/v4/reactions')
    expect(capturedBody).toEqual({
      user_id: 'user-1',
      post_id: 'post-1',
      emoji_name: 'thumbsup',
    })
    if (result.status === 'committed') {
      expect(result.data).toMatchObject({
        user_id: 'user-1',
        post_id: 'post-1',
        emoji_name: 'thumbsup',
      })
    }
  })

  it('throws when user_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { post_id: 'post-1', emoji_name: 'thumbsup' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: user_id/)
  })

  it('throws when post_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { user_id: 'user-1', emoji_name: 'thumbsup' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: post_id/)
  })

  it('throws when emoji_name is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { user_id: 'user-1', post_id: 'post-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: emoji_name/)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      mattermostConnector.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { user_id: 'user-1', post_id: 'post-1', emoji_name: 'thumbsup' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
