import { afterEach, describe, expect, it, vi } from 'vitest'
import { twitterConnector } from '../src/connectors/adapters/twitter.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_twitter_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'twitter',
    label: 'Drew Twitter',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'tw-api-key',
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

describe('twitter adapter manifest', () => {
  it('classifies itself as the comms category and exposes the twitter kind', () => {
    expect(twitterConnector.manifest.kind).toBe('twitter')
    expect(twitterConnector.manifest.category).toBe('comms')
    expect(twitterConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth as preferred auth while retaining API-key token support', () => {
    const auth = twitterConnector.manifest.auth
    expect(auth.kind).toBe('one_of')
    if (auth.kind !== 'one_of') throw new Error('unreachable')
    expect(auth.preferred).toBe('oauth2')
    expect(auth.options.map((option) => option.kind)).toEqual(['oauth2', 'api-key'])
    expect(auth.options[1]).toMatchObject({
      kind: 'api-key',
      hint: expect.stringMatching(/Twitter/i),
    })
  })

  it('covers tweets create and reply capability surface', () => {
    const names = twitterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tweets.create')
    expect(names).toContain('tweets.reply')
  })

  it('marks tweet operations as mutations', () => {
    const mutations = twitterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('tweets.create')
    expect(mutations).toContain('tweets.reply')
  })

  it('exposes delete, like, retweet, and dm send write capabilities', () => {
    const names = twitterConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tweets.delete')
    expect(names).toContain('tweets.like')
    expect(names).toContain('tweets.retweet')
    expect(names).toContain('dms.send')
  })
})

describe('twitter write capabilities', () => {
  const adapter = twitterConnector

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('tweets.delete issues DELETE /tweets/{id} and returns committed', async () => {
    let calledUrl = ''
    let calledMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      return jsonResponse({ data: { deleted: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tweets.delete',
      args: { id: '1234567890' },
      idempotencyKey: 'idemp-del-1',
    })
    expect(calledMethod).toBe('DELETE')
    expect(calledUrl).toBe('https://api.twitter.com/2/tweets/1234567890')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect(result.data).toEqual({ data: { deleted: true } })
    }
  })

  it('tweets.delete rejects missing id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.delete',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
  })

  it('tweets.delete surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('unauthorized', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      }),
    ))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.delete',
        args: { id: '1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('tweets.like POSTs to /users/{user_id}/likes with tweet_id body', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ data: { liked: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tweets.like',
      args: { user_id: 'user-42', tweet_id: 'tw-99' },
      idempotencyKey: 'idemp-like-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toBe('https://api.twitter.com/2/users/user-42/likes')
    expect(calledBody).toEqual({ tweet_id: 'tw-99' })
    expect(result.status).toBe('committed')
  })

  it('tweets.like rejects missing args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.like',
        args: { tweet_id: 'tw-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: user_id/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.like',
        args: { user_id: 'u-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: tweet_id/)
  })

  it('tweets.like surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      }),
    ))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.like',
        args: { user_id: 'u', tweet_id: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('tweets.retweet POSTs to /users/{user_id}/retweets with tweet_id body', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ data: { retweeted: true } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tweets.retweet',
      args: { user_id: 'user-42', tweet_id: 'tw-99' },
      idempotencyKey: 'idemp-rt-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toBe('https://api.twitter.com/2/users/user-42/retweets')
    expect(calledBody).toEqual({ tweet_id: 'tw-99' })
    expect(result.status).toBe('committed')
  })

  it('tweets.retweet rejects missing args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.retweet',
        args: { tweet_id: 'tw-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: user_id/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.retweet',
        args: { user_id: 'u-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: tweet_id/)
  })

  it('tweets.retweet surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('nope', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      }),
    ))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'tweets.retweet',
        args: { user_id: 'u', tweet_id: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('dms.send POSTs to /dm_conversations/with/{participant_id}/messages with text', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let calledBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ data: { dm_conversation_id: 'conv-1', dm_event_id: 'evt-1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'dms.send',
      args: { participant_id: 'user-77', text: 'hello' },
      idempotencyKey: 'idemp-dm-1',
    })
    expect(calledMethod).toBe('POST')
    expect(calledUrl).toBe('https://api.twitter.com/2/dm_conversations/with/user-77/messages')
    expect(calledBody).toEqual({ text: 'hello' })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.data).toEqual({ data: { dm_conversation_id: 'conv-1', dm_event_id: 'evt-1' } })
    }
  })

  it('dms.send rejects missing args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'dms.send',
        args: { text: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: participant_id/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'dms.send',
        args: { participant_id: 'u-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: text/)
  })

  it('dms.send surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      }),
    ))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'dms.send',
        args: { participant_id: 'u', text: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
