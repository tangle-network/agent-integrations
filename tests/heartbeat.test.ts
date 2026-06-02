import { afterEach, describe, expect, it, vi } from 'vitest'
import { heartbeatConnector } from '../src/connectors/adapters/heartbeat.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_heartbeat_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'heartbeat',
    label: 'Heartbeat',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'hb_test_key' },
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

describe('heartbeat adapter manifest', () => {
  it('classifies itself as the comms category and exposes the heartbeat kind', () => {
    expect(heartbeatConnector.manifest.kind).toBe('heartbeat')
    expect(heartbeatConnector.manifest.category).toBe('comms')
    expect(heartbeatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = heartbeatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new write surface (users.create, threads.create, messages.create)', () => {
    const names = heartbeatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['messages.create', 'threads.create', 'users.create'])
    const mutations = heartbeatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['messages.create', 'threads.create', 'users.create'])
  })

  it('marks every mutation as a native-idempotency external effect', () => {
    const mutations = heartbeatConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('unreachable')
      expect(m.cas).toBe('native-idempotency')
      expect(m.externalEffect).toBe(true)
    }
  })
})

describe('heartbeat adapter execution — threads.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /threads with bearer-token auth and the four required fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'thread_1', channel_id: 'chan_1', title: 'Welcome', body: 'Hi' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const inv: ConnectorInvocation = {
      source: source(),
      capabilityName: 'threads.create',
      args: {
        channel_id: 'chan_1',
        title: 'Welcome',
        body: 'Hi',
        sender_user_id: 'user_42',
      },
      idempotencyKey: 'k-threads-1',
    }

    const result = await heartbeatConnector.executeMutation!(inv)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({ id: 'thread_1', channel_id: 'chan_1' })

    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.heartbeat.com/api/threads')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hb_test_key')
    expect(JSON.parse(String(init.body))).toEqual({
      channel_id: 'chan_1',
      title: 'Welcome',
      body: 'Hi',
      sender_user_id: 'user_42',
    })
  })

  it('throws when channel_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { title: 't', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/channel_id/)
  })

  it('throws when title is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { channel_id: 'c', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/title/)
  })

  it('throws when body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { channel_id: 'c', title: 't', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/body/)
  })

  it('throws when sender_user_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { channel_id: 'c', title: 't', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/sender_user_id/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { channel_id: 'c', title: 't', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'threads.create',
        args: { channel_id: 'c', title: 't', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('heartbeat adapter execution — messages.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /messages with bearer-token auth and the three required fields', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'msg_1', thread_id: 'thread_1', body: 'Reply' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const inv: ConnectorInvocation = {
      source: source(),
      capabilityName: 'messages.create',
      args: {
        thread_id: 'thread_1',
        body: 'Reply',
        sender_user_id: 'user_42',
      },
      idempotencyKey: 'k-msg-1',
    }

    const result = await heartbeatConnector.executeMutation!(inv)
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.idempotentReplay).toBe(false)
    expect(typeof result.committedAt).toBe('number')
    expect(result.data).toMatchObject({ id: 'msg_1', thread_id: 'thread_1' })

    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.heartbeat.com/api/messages')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer hb_test_key')
    expect(JSON.parse(String(init.body))).toEqual({
      thread_id: 'thread_1',
      body: 'Reply',
      sender_user_id: 'user_42',
    })
  })

  it('throws when thread_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.create',
        args: { body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/thread_id/)
  })

  it('throws when body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.create',
        args: { thread_id: 't', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/body/)
  })

  it('throws when sender_user_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.create',
        args: { thread_id: 't', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/sender_user_id/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.create',
        args: { thread_id: 't', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      heartbeatConnector.executeMutation!({
        source: source(),
        capabilityName: 'messages.create',
        args: { thread_id: 't', body: 'b', sender_user_id: 'u' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
