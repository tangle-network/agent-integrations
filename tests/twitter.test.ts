import { afterEach, describe, expect, it, vi } from 'vitest'
import { twitter, twitterConnector } from '../src/connectors/adapters/twitter.js'
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

  it('exposes the six quest-verification read capabilities classified as reads', () => {
    const reads = twitterConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([
      'tweets.likingUsers',
      'tweets.retweetedBy',
      'users.following',
      'users.me',
      'users.mentions',
      'users.tweets',
    ])
  })

  it('requests the official like.read + follows.read scopes the reads need while keeping the existing scopes', () => {
    const auth = twitterConnector.manifest.auth
    if (auth.kind !== 'one_of') throw new Error('unreachable')
    const oauth = auth.options.find((option) => option.kind === 'oauth2')
    if (!oauth || oauth.kind !== 'oauth2') throw new Error('expected an oauth2 option')
    // Singular `like.read` (NOT the plural `likes.read` the issue text used) —
    // matches X's scope catalog and the connector's existing `like.write`.
    expect(oauth.scopes).toContain('like.read')
    expect(oauth.scopes).not.toContain('likes.read')
    expect(oauth.scopes).toContain('follows.read')
    expect(oauth.scopes).toEqual(
      expect.arrayContaining(['tweet.read', 'tweet.write', 'users.read', 'like.write', 'offline.access']),
    )
  })
})

describe('twitter read capabilities', () => {
  const adapter = twitterConnector

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function captureGet(body: unknown): { url: string; method: string; headers: Record<string, string> } {
    const captured = { url: '', method: '', headers: {} as Record<string, string> }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        captured.url = String(input)
        captured.method = init?.method ?? ''
        captured.headers = (init?.headers as Record<string, string>) ?? {}
        return jsonResponse(body)
      }),
    )
    return captured
  }

  it('users.me GETs /users/me with the connection bearer and no field selector by default', async () => {
    const captured = captureGet({ data: { id: 'u-1', username: 'drew' } })
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.me',
      args: {},
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(captured.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/users/me')
    expect(url.searchParams.has('user.fields')).toBe(false)
    expect(captured.headers.authorization).toBe('Bearer tw-api-key')
    expect(result.data).toEqual({ data: { id: 'u-1', username: 'drew' } })
    expect(result.fetchedAt).toBeGreaterThan(0)
  })

  it('users.me forwards user_fields as the X user.fields query param', async () => {
    const captured = captureGet({ data: { id: 'u-1' } })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.me',
      args: { user_fields: 'public_metrics,created_at' },
      idempotencyKey: 'k',
    })
    expect(new URL(captured.url).searchParams.get('user.fields')).toBe('public_metrics,created_at')
  })

  it('users.following GETs /users/{id}/following with the pagination query', async () => {
    const captured = captureGet({ data: [{ id: 'f-1' }], meta: { next_token: 'NT' } })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.following',
      args: { id: 'u-1', max_results: 1000, pagination_token: 'CURSOR' },
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(captured.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/users/u-1/following')
    expect(url.searchParams.get('max_results')).toBe('1000')
    expect(url.searchParams.get('pagination_token')).toBe('CURSOR')
  })

  it('users.following requires the user id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'users.following',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: id/)
  })

  it('users.tweets GETs /users/{id}/tweets pinning tweet.fields and dropping absent pagination', async () => {
    const captured = captureGet({ data: [] })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.tweets',
      args: { id: 'u-1', max_results: 100 },
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/users/u-1/tweets')
    expect(url.searchParams.get('tweet.fields')).toBe('text,created_at')
    expect(url.searchParams.get('max_results')).toBe('100')
    expect(url.searchParams.has('pagination_token')).toBe(false)
  })

  it('tweets.retweetedBy GETs /tweets/{id}/retweeted_by', async () => {
    const captured = captureGet({ data: [] })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'tweets.retweetedBy',
      args: { id: 'tw-9' },
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(captured.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/tweets/tw-9/retweeted_by')
  })

  it('tweets.likingUsers GETs /tweets/{id}/liking_users', async () => {
    const captured = captureGet({ data: [] })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'tweets.likingUsers',
      args: { id: 'tw-9' },
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(captured.method).toBe('GET')
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/tweets/tw-9/liking_users')
  })

  it('users.mentions GETs /users/{id}/mentions pinning tweet.fields=author_id,text', async () => {
    const captured = captureGet({ data: [] })
    await adapter.executeRead!({
      source: source(),
      capabilityName: 'users.mentions',
      args: { id: 'u-1' },
      idempotencyKey: 'k',
    })
    const url = new URL(captured.url)
    expect(url.origin + url.pathname).toBe('https://api.twitter.com/2/users/u-1/mentions')
    expect(url.searchParams.get('tweet.fields')).toBe('author_id,text')
  })

  it.each(['users.tweets', 'tweets.retweetedBy', 'tweets.likingUsers', 'users.mentions'])(
    '%s rejects a missing required id',
    async (capabilityName) => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeRead!({
          source: source(),
          capabilityName,
          args: {},
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/missing required argument: id/)
    },
  )

  it('surfaces CredentialsExpired when a read hits 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'users.me',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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

describe('twitter factory', () => {
  const adapter = twitter({ clientId: 'cid', clientSecret: 'sec' })
  const expectedBasic = `Basic ${Buffer.from('cid:sec').toString('base64')}`

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('carries the exact manifest of the const adapter (kind stays `twitter`)', () => {
    expect(adapter.manifest).toEqual(twitterConnector.manifest)
    expect(adapter.manifest.kind).toBe('twitter')
  })

  it('exchangeOAuth POSTs the code grant with Basic client auth and relays the broker codeVerifier', async () => {
    let calledUrl = ''
    let calledHeaders: Record<string, string> = {}
    let calledBody: URLSearchParams | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledHeaders = init?.headers as Record<string, string>
      calledBody = new URLSearchParams(String(init!.body))
      return jsonResponse({
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 7200,
        token_type: 'bearer',
        scope: 'tweet.read tweet.write users.read like.write offline.access',
      })
    }))

    const result = await adapter.exchangeOAuth!({
      code: 'auth_code_xyz',
      state: 'state_xyz',
      codeVerifier: 'cv_from_broker',
      redirectUri: 'https://app.example.com/cb?provider=twitter',
    })
    expect(calledUrl).toBe('https://api.twitter.com/2/oauth2/token')
    expect(calledHeaders.authorization).toBe(expectedBasic)
    expect(calledBody!.get('grant_type')).toBe('authorization_code')
    expect(calledBody!.get('code')).toBe('auth_code_xyz')
    expect(calledBody!.get('redirect_uri')).toBe('https://app.example.com/cb?provider=twitter')
    expect(calledBody!.get('code_verifier')).toBe('cv_from_broker')
    expect(calledBody!.get('client_id')).toBe('cid')
    expect(result.credentials.kind).toBe('oauth2')
    if (result.credentials.kind === 'oauth2') {
      expect(result.credentials.accessToken).toBe('at_new')
      expect(result.credentials.refreshToken).toBe('rt_new')
      expect(result.credentials.expiresAt).toBeGreaterThan(Date.now())
    }
    expect(result.scopes).toEqual(['tweet.read', 'tweet.write', 'users.read', 'like.write', 'offline.access'])
  })

  it('exchangeOAuth surfaces the upstream error body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_request' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      }),
    ))
    await expect(
      adapter.exchangeOAuth!({
        code: 'bad',
        state: 's',
        codeVerifier: 'cv',
        redirectUri: 'https://app.example.com/cb',
      }),
    ).rejects.toThrow(/authorization_code token request failed: 400/)
  })

  it('refreshToken POSTs the refresh grant with Basic client auth and keeps the prior refresh token when omitted', async () => {
    let calledHeaders: Record<string, string> = {}
    let calledBody: URLSearchParams | null = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calledHeaders = init?.headers as Record<string, string>
      calledBody = new URLSearchParams(String(init!.body))
      return jsonResponse({ access_token: 'at_fresh', expires_in: 7200, token_type: 'bearer' })
    }))

    const refreshed = await adapter.refreshToken!({
      kind: 'oauth2',
      accessToken: 'at_old',
      refreshToken: 'rt_old',
      expiresAt: Date.now() - 1_000,
    })
    expect(calledHeaders.authorization).toBe(expectedBasic)
    expect(calledBody!.get('grant_type')).toBe('refresh_token')
    expect(calledBody!.get('refresh_token')).toBe('rt_old')
    expect(calledBody!.get('client_id')).toBe('cid')
    if (refreshed.kind !== 'oauth2') throw new Error('expected oauth2 credentials')
    expect(refreshed.accessToken).toBe('at_fresh')
    expect(refreshed.refreshToken).toBe('rt_old')
  })

  it('refreshToken rejects non-oauth2 credentials and missing refresh tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.refreshToken!({ kind: 'api-key', apiKey: 'k' }),
    ).rejects.toThrow(/missing refresh token/)
    await expect(
      adapter.refreshToken!({ kind: 'oauth2', accessToken: 'at' }),
    ).rejects.toThrow(/missing refresh token/)
  })

  it('still executes the declarative twitter surface (tweets.create posts with the connection bearer)', async () => {
    let calledUrl = ''
    let calledHeaders: Record<string, string> = {}
    let calledBody: unknown = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledHeaders = init?.headers as Record<string, string>
      calledBody = JSON.parse(init!.body as string)
      return jsonResponse({ data: { id: 'tw-1', text: 'hello' } })
    }))

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'tweets.create',
      args: { text: 'hello' },
      idempotencyKey: 'idemp-create-1',
    })
    expect(calledUrl).toBe('https://api.twitter.com/2/tweets')
    expect(calledHeaders.authorization).toBe('Bearer tw-api-key')
    expect(calledBody).toEqual({ text: 'hello' })
    expect(result.status).toBe('committed')
  })
})
