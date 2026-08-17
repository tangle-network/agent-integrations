import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider, manifestToConnector } from '../src/adapter-provider.js'
import { reddit, redditConnector } from '../src/connectors/adapters/reddit.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const EXPECTED_USER_AGENT = 'web:tools.tangle.integration-hub:v1.0 (contact: https://tangle.tools)'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reddit adapter manifest', () => {
  it('classifies itself as the comms category and exposes the reddit kind', () => {
    expect(redditConnector.manifest.kind).toBe('reddit')
    expect(redditConnector.manifest.category).toBe('comms')
    expect(redditConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares the documented long-lived confidential OAuth flow', () => {
    const auth = redditConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://www.reddit.com/api/v1/authorize')
    expect(auth.tokenUrl).toBe('https://www.reddit.com/api/v1/access_token')
    expect(auth.scopes).toEqual(['identity', 'read', 'submit', 'edit'])
    expect(auth.extraAuthParams).toEqual({ duration: 'permanent' })
    expect(auth.tokenClientAuthMethod).toBe('client_secret_basic')
    expect(auth.tokenRequestHeaders).toEqual({ 'User-Agent': EXPECTED_USER_AGENT })
    expect(auth.pkce).toBe('unsupported')
  })

  it('covers the post and comment surface without claiming provider idempotency', () => {
    const names = redditConnector.manifest.capabilities.map((capability) => capability.name).sort()
    expect(names).toEqual(
      [
        'post.retrieve',
        'post.details',
        'post.create',
        'comment.create',
        'comments.fetch',
        'post.edit',
        'comment.edit',
        'post.delete',
        'comment.delete',
      ].sort(),
    )
    const mutations = redditConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(6)
    for (const mutation of mutations) {
      expect(mutation.cas).toBe('none')
      expect(mutation.externalEffect).toBe(true)
    }
    const connector = manifestToConnector('reddit', redditConnector)
    const writes = connector.actions.filter((action) => action.risk !== 'read')
    expect(writes).toHaveLength(6)
    expect(writes.every((action) => action.approvalRequired === true)).toBe(true)
  })
})

describe('reddit OAuth request shape', () => {
  it('requests permanent access without undocumented PKCE and uses HTTP Basic at exchange', async () => {
    const tokenFetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'reddit_access',
      refresh_token: 'reddit_refresh',
      expires_in: 3600,
      scope: 'identity read submit edit',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const provider = createConnectorAdapterProvider({
      adapters: [redditConnector],
      resolveDataSource: () => source(),
      resolveOAuthClient: () => ({ clientId: 'client:id', clientSecret: 's+e%cret' }),
      fetchImpl: tokenFetch as unknown as typeof fetch,
    })

    const started = await provider.startAuth!({
      connectorId: 'reddit',
      owner: { type: 'user', id: 'user_1' },
      requestedScopes: [],
      redirectUri: 'https://id.tangle.tools/api/integrations/oauth/callback',
      state: 'state_1',
      codeChallenge: 'caller-must-not-force-pkce',
    })
    const authorizationUrl = new URL(started.authUrl)
    expect(authorizationUrl.searchParams.get('duration')).toBe('permanent')
    expect(authorizationUrl.searchParams.get('scope')).toBe('identity read submit edit')
    expect(authorizationUrl.searchParams.has('code_challenge')).toBe(false)

    await provider.completeAuth!({
      connectorId: 'reddit',
      owner: { type: 'user', id: 'user_1' },
      code: 'authorization_code',
      state: 'state_1',
      redirectUri: 'https://id.tangle.tools/api/integrations/oauth/callback',
      codeVerifier: 'caller-must-not-force-pkce',
    })

    const [tokenUrl, tokenInit] = tokenFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(tokenUrl).toBe('https://www.reddit.com/api/v1/access_token')
    expect(headerValue(tokenInit.headers, 'authorization')).toBe(
      `Basic ${Buffer.from('client%3Aid:s%2Be%25cret').toString('base64')}`,
    )
    expect(headerValue(tokenInit.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
    const tokenBody = tokenInit.body as URLSearchParams
    expect(tokenBody.get('grant_type')).toBe('authorization_code')
    expect(tokenBody.has('client_id')).toBe(false)
    expect(tokenBody.has('client_secret')).toBe(false)
    expect(tokenBody.has('code_verifier')).toBe(false)
  })

  it('uses the credential-bound factory for the platform-owned token exchange', async () => {
    const now = Date.parse('2026-08-10T19:00:00.000Z')
    const tokenFetch = vi.fn(async () => Response.json({
      access_token: 'reddit_access',
      refresh_token: 'reddit_refresh',
      expires_in: 3600,
      scope: 'identity read submit edit',
    }))
    const adapter = reddit({
      clientId: 'client:id',
      clientSecret: 's+e%cret',
      fetchImpl: tokenFetch as unknown as typeof fetch,
      now: () => now,
    })

    const result = await adapter.exchangeOAuth!({
      code: 'authorization_code',
      state: 'state_1',
      redirectUri: 'https://id.tangle.tools/api/integrations/oauth/callback',
    })

    expect(result).toEqual({
      credentials: {
        kind: 'oauth2',
        accessToken: 'reddit_access',
        refreshToken: 'reddit_refresh',
        expiresAt: now + 3_600_000,
      },
      scopes: ['identity', 'read', 'submit', 'edit'],
      metadata: {},
    })
    const [tokenUrl, tokenInit] = tokenFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(tokenUrl).toBe('https://www.reddit.com/api/v1/access_token')
    expect(headerValue(tokenInit.headers, 'authorization')).toBe(
      `Basic ${Buffer.from('client%3Aid:s%2Be%25cret').toString('base64')}`,
    )
    expect(headerValue(tokenInit.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
    expect(headerValue(tokenInit.headers, 'content-type')).toBe('application/x-www-form-urlencoded')
    const tokenBody = tokenInit.body as URLSearchParams
    expect(Object.fromEntries(tokenBody)).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization_code',
      redirect_uri: 'https://id.tangle.tools/api/integrations/oauth/callback',
    })
  })

  it('coalesces refresh by source, isolates tenants, and awaits durable rotation', async () => {
    const now = Date.parse('2026-08-10T19:00:00.000Z')
    let tokenRequests = 0
    let apiRequests = 0
    const tokenBodies: URLSearchParams[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://www.reddit.com/api/v1/access_token') {
        tokenRequests += 1
        tokenBodies.push(init?.body as URLSearchParams)
        expect(headerValue(init?.headers, 'authorization')).toBe(
          `Basic ${Buffer.from('reddit_client:reddit_secret').toString('base64')}`,
        )
        expect(headerValue(init?.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
        return Response.json({ access_token: `fresh_access_${tokenRequests}`, expires_in: 3600 })
      }
      apiRequests += 1
      expect(String(input)).toBe('https://oauth.reddit.com/api/info?id=t3_abc123')
      expect(headerValue(init?.headers, 'authorization')).toMatch(/^Bearer fresh_access_[12]$/)
      return Response.json({ data: { children: [] } })
    })
    vi.stubGlobal('fetch', fetchImpl)
    const adapter = reddit({
      clientId: 'reddit_client',
      clientSecret: 'reddit_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    })
    const invoke = (
      sourceId: string,
      onCredentialsRotated?: (credentials: ResolvedDataSource['credentials']) => Promise<void>,
    ) => adapter.executeRead!({
      source: expiredSource(sourceId, now),
      capabilityName: 'post.retrieve',
      args: { postId: 't3_abc123' },
      idempotencyKey: `read-${sourceId}`,
      onCredentialsRotated,
    })

    await expect(invoke('missing-persistence')).rejects.toThrow(
      'credential rotation persistence callback is required',
    )
    expect(fetchImpl).not.toHaveBeenCalled()

    let releasePersistence!: () => void
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const persisted: unknown[] = []
    const persist = async (credentials: ResolvedDataSource['credentials']) => {
      persisted.push(credentials)
      await persistenceGate
    }
    const first = invoke('same-source', persist)
    const second = invoke('same-source', persist)
    await vi.waitFor(() => expect(persisted).toHaveLength(1))
    expect(tokenRequests).toBe(1)
    expect(apiRequests).toBe(0)
    releasePersistence()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(tokenRequests).toBe(1)
    expect(apiRequests).toBe(2)
    expect(persisted).toEqual([{
      kind: 'oauth2',
      accessToken: 'fresh_access_1',
      refreshToken: 'refresh_same-source',
      expiresAt: now + 3_600_000,
    }])
    expect(Object.fromEntries(tokenBodies[0]!)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh_same-source',
    })

    tokenRequests = 0
    apiRequests = 0
    tokenBodies.length = 0
    await expect(Promise.all([
      invoke('tenant-a', async () => {}),
      invoke('tenant-b', async () => {}),
    ])).resolves.toHaveLength(2)
    expect(tokenRequests).toBe(2)
    expect(apiRequests).toBe(2)
    expect(tokenBodies.map((body) => body.get('refresh_token')).sort()).toEqual([
      'refresh_tenant-a',
      'refresh_tenant-b',
    ])
  })
})

describe('reddit provider request shapes', () => {
  it('tests identity with the truthful integration User-Agent', async () => {
    const fetchMock = mockFetch({ name: 'tangle-test' })

    await expect(redditConnector.test!(source())).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/v1/me')
    expect(headerValue(init.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
  })

  it('retrieves a post fullname through /api/info without an undeclared path argument', async () => {
    const fetchMock = mockFetch({ data: { children: [] } })

    await redditConnector.executeRead!({
      source: source(),
      capabilityName: 'post.retrieve',
      args: { postId: 't3_abc123' },
      idempotencyKey: 'read-post',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/api/info')
    expect(url.searchParams.get('id')).toBe('t3_abc123')
    expect(headerValue(init.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
  })

  it('keeps subreddit thread details on the documented comments path', async () => {
    const fetchMock = mockFetch([])

    await redditConnector.executeRead!({
      source: source(),
      capabilityName: 'post.details',
      args: { subreddit: 'tangle', postId: 'abc123' },
      idempotencyKey: 'read-thread',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe('/r/tangle/comments/abc123')
  })

  it.each([
    {
      capabilityName: 'post.create',
      args: { subreddit: 'tangle dev', title: 'Hello & goodbye', kind: 'self', text: 'Body + text' },
      path: '/api/submit',
      form: {
        api_type: 'json',
        sr: 'tangle dev',
        title: 'Hello & goodbye',
        kind: 'self',
        text: 'Body + text',
      },
    },
    {
      capabilityName: 'comment.create',
      args: { parentId: 't3_abc123', text: 'A reply' },
      path: '/api/comment',
      form: { api_type: 'json', thing_id: 't3_abc123', text: 'A reply' },
    },
    {
      capabilityName: 'post.create',
      args: { subreddit: 'tangle', title: 'A link', kind: 'link', url: 'https://tangle.tools/a?b=1' },
      path: '/api/submit',
      form: {
        api_type: 'json',
        sr: 'tangle',
        title: 'A link',
        kind: 'link',
        url: 'https://tangle.tools/a?b=1',
      },
    },
    {
      capabilityName: 'post.edit',
      args: { thingId: 't3_abc123', text: 'Updated post' },
      path: '/api/editusertext',
      form: { api_type: 'json', thing_id: 't3_abc123', text: 'Updated post' },
    },
    {
      capabilityName: 'comment.edit',
      args: { thingId: 't1_def456', text: 'Updated comment' },
      path: '/api/editusertext',
      form: { api_type: 'json', thing_id: 't1_def456', text: 'Updated comment' },
    },
    {
      capabilityName: 'post.delete',
      args: { thingId: 't3_abc123' },
      path: '/api/del',
      form: { id: 't3_abc123' },
    },
    {
      capabilityName: 'comment.delete',
      args: { thingId: 't1_def456' },
      path: '/api/del',
      form: { id: 't1_def456' },
    },
  ])('form-encodes $capabilityName at the documented endpoint', async ({
    capabilityName,
    args,
    path,
    form,
  }) => {
    const fetchMock = mockFetch({ json: { errors: [] } })

    await redditConnector.executeMutation!({
      source: source(),
      capabilityName,
      args,
      idempotencyKey: `write-${capabilityName}`,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.pathname).toBe(path)
    expect(headerValue(init.headers, 'content-type')).toBe('application/x-www-form-urlencoded')
    expect(headerValue(init.headers, 'user-agent')).toBe(EXPECTED_USER_AGENT)
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual(form)
  })
})

function source(): ResolvedDataSource {
  return {
    id: 'source_reddit',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'reddit',
    label: 'Reddit',
    consistencyModel: 'authoritative',
    scopes: ['identity', 'read', 'submit', 'edit'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'reddit_access', refreshToken: 'reddit_refresh' },
    status: 'active',
  }
}

function expiredSource(id: string, now: number): ResolvedDataSource {
  return {
    ...source(),
    id,
    credentials: {
      kind: 'oauth2',
      accessToken: `expired_${id}`,
      refreshToken: `refresh_${id}`,
      expiresAt: now - 1_000,
    },
  }
}

function mockFetch(body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  return new Headers(headers).get(name)
}
