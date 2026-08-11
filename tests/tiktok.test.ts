import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/adapter-provider.js'
import { getIntegrationSpec, resolveConnectorAuthSpec } from '../src/specs/index.js'
import {
  tiktok,
  tiktokConnector,
  validateConnectorManifest,
  type ConnectorCredentials,
  type ResolvedDataSource,
} from '../src/connectors/index.js'

const OWNER = { type: 'user' as const, id: 'user_tiktok' }
const REDIRECT_URI = 'https://id.tangle.tools/api/integrations/oauth/tiktok/callback'

afterEach(() => vi.unstubAllGlobals())

function source(
  credentials: ConnectorCredentials = {
    kind: 'oauth2',
    accessToken: 'tiktok-access-token',
    refreshToken: 'tiktok-refresh-token',
  },
): ResolvedDataSource {
  return {
    id: 'source_tiktok',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'tiktok',
    label: 'Tangle TikTok',
    consistencyModel: 'advisory',
    scopes: ['user.info.basic', 'video.list', 'video.publish'],
    metadata: { openId: 'open_123' },
    credentials,
    status: 'active',
  }
}

function success(data: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      data,
      error: { code: 'ok', message: '', log_id: 'log_1' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function creatorInfo(
  overrides: Record<string, unknown> = {},
): Response {
  return success({
    creator_username: 'tangle',
    privacy_level_options: [
      'PUBLIC_TO_EVERYONE',
      'MUTUAL_FOLLOW_FRIENDS',
      'SELF_ONLY',
    ],
    comment_disabled: false,
    duet_disabled: false,
    stitch_disabled: false,
    max_video_post_duration_sec: 300,
    ...overrides,
  })
}

describe('TikTok manifest and setup contract', () => {
  it('ships seven current API v2 actions with exact least-privilege scopes', () => {
    expect(validateConnectorManifest(tiktokConnector.manifest)).toEqual({
      ok: true,
      issues: [],
    })
    expect(tiktokConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'user.info',
      'videos.list',
      'videos.query',
      'publishing.creatorInfo',
      'publishing.status',
      'publishing.videoFromUrl',
      'publishing.photosFromUrls',
    ])
    const auth = tiktokConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') return
    expect(auth).toMatchObject({
      authorizationUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
      scopes: ['user.info.basic', 'video.list', 'video.publish'],
      scopeSeparator: ',',
      authorizationClientIdParam: 'client_key',
      tokenClientIdParam: 'client_key',
      tokenClientSecretParam: 'client_secret',
      clientIdEnv: 'TIKTOK_OAUTH_CLIENT_KEY',
      clientSecretEnv: 'TIKTOK_OAUTH_CLIENT_SECRET',
      tokenMetadata: { openId: 'open_id' },
    })
  })

  it('marks every direct post as approval-required without claiming provider idempotency', () => {
    const manifestMutations = tiktokConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(manifestMutations).toHaveLength(2)
    for (const capability of manifestMutations) {
      if (capability.class !== 'mutation') continue
      expect(capability.externalEffect).toBe(true)
      expect(capability.cas).toBe('none')
      expect(capability.requiredScopes).toEqual(['video.publish'])
    }

    const spec = getIntegrationSpec('tiktok')
    expect(spec?.status).toBe('executable')
    expect(spec?.actions).toHaveLength(7)
    for (const action of spec?.actions ?? []) {
      expect(action.approvalRequired).toBe(action.risk === 'write' ? true : undefined)
    }
    expect(spec?.setup.knownQuirks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'private-until-audit', severity: 'critical' }),
        expect.objectContaining({ id: 'verified-pull-url', severity: 'critical' }),
      ]),
    )
    if (spec?.auth.mode !== 'oauth2') throw new Error('expected TikTok OAuth2')
    expect(
      Object.fromEntries(
        spec.auth.scopes.map((scope) => [scope.providerScope, scope.risk]),
      ),
    ).toEqual({
      'user.info.basic': 'read',
      'video.list': 'read',
      'video.publish': 'write',
    })
  })

  it('publishes the non-standard OAuth parameter names to consumers', () => {
    expect(resolveConnectorAuthSpec('tiktok')).toMatchObject({
      authKind: 'oauth2',
      requestedScopes: ['user.info.basic', 'video.list', 'video.publish'],
      scopeSeparator: ',',
      authorizationClientIdParam: 'client_key',
      tokenClientIdParam: 'client_key',
      tokenClientSecretParam: 'client_secret',
    })
  })
})

describe('TikTok OAuth', () => {
  it('uses client_key and comma-delimited scopes in the generic provider flow', async () => {
    let tokenBody: URLSearchParams | undefined
    const provider = createConnectorAdapterProvider({
      adapters: [tiktokConnector],
      resolveDataSource: () => source(),
      resolveOAuthClient: () => ({
        clientId: 'tiktok-client-key',
        clientSecret: 'tiktok-client-secret',
      }),
      fetchImpl: vi.fn(async (_input, init) => {
        tokenBody = init?.body as URLSearchParams
        return new Response(
          JSON.stringify({
            access_token: 'access-new',
            refresh_token: 'refresh-new',
            expires_in: 86400,
            scope: 'user.info.basic,video.list,video.publish',
            open_id: 'open_456',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }) as typeof fetch,
    })

    const started = await provider.startAuth!({
      connectorId: 'tiktok',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT_URI,
      state: 'state_fixed',
    })
    const authorizationUrl = new URL(started.authUrl)
    expect(authorizationUrl.searchParams.get('client_key')).toBe('tiktok-client-key')
    expect(authorizationUrl.searchParams.has('client_id')).toBe(false)
    expect(authorizationUrl.searchParams.get('scope')).toBe(
      'user.info.basic,video.list,video.publish',
    )

    const connection = await provider.completeAuth!({
      connectorId: 'tiktok',
      owner: OWNER,
      code: 'authorization-code',
      state: 'state_fixed',
      redirectUri: REDIRECT_URI,
    })
    expect(tokenBody?.get('client_key')).toBe('tiktok-client-key')
    expect(tokenBody?.get('client_secret')).toBe('tiktok-client-secret')
    expect(tokenBody?.has('client_id')).toBe(false)
    expect(connection.grantedScopes).toEqual([
      'user.info.basic',
      'video.list',
      'video.publish',
    ])
    expect(connection.metadata).toEqual({ openId: 'open_456' })
  })

  it('exchanges and refreshes through TikTok web OAuth with rotating refresh tokens', async () => {
    const bodies: URLSearchParams[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init?.body as URLSearchParams)
        return new Response(
          JSON.stringify({
            access_token: `access-${bodies.length}`,
            refresh_token: `refresh-${bodies.length}`,
            expires_in: 86400,
            open_id: 'open_123',
            scope: 'user.info.basic,video.list,video.publish',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }),
    )
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })

    const exchanged = await adapter.exchangeOAuth!({
      code: 'authorization-code',
      state: 'state',
      codeVerifier: 'pkce-verifier',
      redirectUri: REDIRECT_URI,
    })
    expect(bodies[0]?.get('client_key')).toBe('tiktok-client-key')
    expect(bodies[0]?.get('client_secret')).toBe('tiktok-client-secret')
    // TikTok documents code_verifier for mobile and desktop apps only.
    expect(bodies[0]?.has('code_verifier')).toBe(false)
    expect(bodies[0]?.has('client_id')).toBe(false)
    expect(exchanged.metadata).toEqual({ openId: 'open_123' })
    expect(exchanged.scopes).toEqual([
      'user.info.basic',
      'video.list',
      'video.publish',
    ])

    const refreshed = await adapter.refreshToken!(exchanged.credentials)
    expect(bodies[1]?.get('grant_type')).toBe('refresh_token')
    expect(bodies[1]?.get('refresh_token')).toBe('refresh-1')
    expect(refreshed).toMatchObject({
      kind: 'oauth2',
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    })
  })

  it('redacts the client pair and authorization code from token errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          'bad tiktok-client-key tiktok-client-secret authorization-code',
          { status: 400, statusText: 'Bad Request' },
        ),
      ),
    )
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })
    let message = ''
    try {
      await adapter.exchangeOAuth!({
        code: 'authorization-code',
        state: 'state',
        codeVerifier: 'verifier',
        redirectUri: REDIRECT_URI,
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('[REDACTED]')
    expect(message).not.toContain('tiktok-client-key')
    expect(message).not.toContain('tiktok-client-secret')
    expect(message).not.toContain('authorization-code')
  })

  it('does not claim scopes or persist a non-refreshable incomplete grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: 'access-only' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })
    await expect(
      adapter.exchangeOAuth!({
        code: 'authorization-code',
        state: 'state',
        codeVerifier: 'unused-web-pkce-verifier',
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toThrow(/incomplete authorization grant/)
  })
})

describe('TikTok reads', () => {
  it('refreshes an expired token before the call and persists the rotation', async () => {
    const calls: Array<{ url: string; authorization?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined
        calls.push({
          url: String(input),
          authorization: headers?.authorization,
        })
        if (String(input).includes('/v2/oauth/token/')) {
          return new Response(
            JSON.stringify({
              access_token: 'fresh-access-token',
              refresh_token: 'rotated-refresh-token',
              expires_in: 86400,
              scope: 'user.info.basic,video.list,video.publish',
              open_id: 'open_123',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return success({ user: { open_id: 'open_123' } })
      }),
    )
    const onCredentialsRotated = vi.fn()
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })
    await adapter.executeRead!({
      source: source({
        kind: 'oauth2',
        accessToken: 'expired-access-token',
        refreshToken: 'old-refresh-token',
        expiresAt: Date.now() - 1,
      }),
      capabilityName: 'user.info',
      args: {},
      idempotencyKey: 'refresh-before-read',
      onCredentialsRotated,
    })
    expect(calls.map((call) => call.url)).toEqual([
      'https://open.tiktokapis.com/v2/oauth/token/',
      expect.stringContaining('/v2/user/info/'),
    ])
    expect(calls[1]?.authorization).toBe('Bearer fresh-access-token')
    expect(onCredentialsRotated).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'oauth2',
        accessToken: 'fresh-access-token',
        refreshToken: 'rotated-refresh-token',
        expiresAt: expect.any(Number),
      }),
    )
  })

  it('does not refresh a token that remains valid beyond the safety window', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      success({ user: { open_id: 'open_123' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onCredentialsRotated = vi.fn()
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })

    await adapter.executeRead!({
      source: source({
        kind: 'oauth2',
        accessToken: 'still-valid-access-token',
        refreshToken: 'unused-refresh-token',
        expiresAt: Date.now() + 3_600_000,
      }),
      capabilityName: 'user.info',
      args: {},
      idempotencyKey: 'read-with-valid-token',
      onCredentialsRotated,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v2/user/info/')
    expect(onCredentialsRotated).not.toHaveBeenCalled()
  })

  it('fails before network access when an expired token has no refresh token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      success({ user: { open_id: 'open_123' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })

    await expect(
      adapter.executeRead!({
        source: source({
          kind: 'oauth2',
          accessToken: 'expired-access-token',
          expiresAt: Date.now() - 1,
        }),
        capabilityName: 'user.info',
        args: {},
        idempotencyKey: 'read-without-refresh-token',
      }),
    ).rejects.toMatchObject({
      name: 'CredentialsExpired',
      dataSourceId: 'source_tiktok',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails before rotating credentials when no persistence sink is available', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      success({ user: { open_id: 'open_123' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })
    const expiredSource = source({
      kind: 'oauth2',
      accessToken: 'expired-access-token',
      refreshToken: 'unpersistable-refresh-token',
      expiresAt: Date.now() - 1,
    })

    await expect(adapter.executeRead!({
      source: expiredSource,
      capabilityName: 'user.info',
      args: {},
      idempotencyKey: 'read-without-persistence-sink',
    })).rejects.toThrow(/rotation persistence callback is required/)
    await expect(adapter.test(expiredSource)).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining('rotation persistence callback is required'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('coalesces simultaneous refreshes and persists the rotation once', async () => {
    let releaseTokenResponse: (() => void) | undefined
    const tokenResponseReady = new Promise<void>((resolve) => {
      releaseTokenResponse = resolve
    })
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        if (String(input).includes('/v2/oauth/token/')) {
          await tokenResponseReady
          return new Response(
            JSON.stringify({
              access_token: 'shared-fresh-access-token',
              refresh_token: 'shared-rotated-refresh-token',
              expires_in: 86400,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return success({ user: { open_id: 'open_123' } })
      },
    )
    vi.stubGlobal('fetch', fetchMock)
    const onCredentialsRotated = vi.fn()
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })
    const expiredSource = source({
      kind: 'oauth2',
      accessToken: 'expired-access-token',
      refreshToken: 'shared-old-refresh-token',
      expiresAt: Date.now() - 1,
    })

    const first = adapter.executeRead!({
      source: expiredSource,
      capabilityName: 'user.info',
      args: {},
      idempotencyKey: 'simultaneous-read-1',
    })
    const second = adapter.executeRead!({
      source: expiredSource,
      capabilityName: 'user.info',
      args: {},
      idempotencyKey: 'simultaneous-read-2',
      onCredentialsRotated,
    })

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).includes('/v2/oauth/token/'),
        ),
      ).toHaveLength(1)
    })
    releaseTokenResponse?.()
    await Promise.all([first, second])

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/v2/oauth/token/'),
      ),
    ).toHaveLength(1)
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/v2/user/info/'),
      ),
    ).toHaveLength(2)
    expect(onCredentialsRotated).toHaveBeenCalledTimes(1)
    expect(onCredentialsRotated).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'oauth2',
        accessToken: 'shared-fresh-access-token',
        refreshToken: 'shared-rotated-refresh-token',
      }),
    )
  })

  it('refreshes before a health check and exposes the full rotated envelope', async () => {
    const calls: Array<{ url: string; authorization?: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined
        calls.push({
          url: String(input),
          authorization: headers?.authorization,
        })
        if (String(input).includes('/v2/oauth/token/')) {
          return new Response(
            JSON.stringify({
              access_token: 'healthcheck-access-token',
              refresh_token: 'healthcheck-refresh-token',
              expires_in: 86400,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        return success({ user: { open_id: 'open_123' } })
      }),
    )
    const onCredentialsRotated = vi.fn()
    const adapter = tiktok({
      clientId: 'tiktok-client-key',
      clientSecret: 'tiktok-client-secret',
    })

    await expect(adapter.test(source({
      kind: 'oauth2',
      accessToken: 'expired-healthcheck-token',
      refreshToken: 'old-healthcheck-refresh-token',
      expiresAt: Date.now() - 1,
    }), onCredentialsRotated)).resolves.toEqual({ ok: true })

    expect(calls.map((call) => call.url)).toEqual([
      'https://open.tiktokapis.com/v2/oauth/token/',
      expect.stringContaining('/v2/user/info/'),
    ])
    expect(calls[1]?.authorization).toBe('Bearer healthcheck-access-token')
    expect(onCredentialsRotated).toHaveBeenCalledTimes(1)
    expect(onCredentialsRotated).toHaveBeenCalledWith({
      kind: 'oauth2',
      accessToken: 'healthcheck-access-token',
      refreshToken: 'healthcheck-refresh-token',
      expiresAt: expect.any(Number),
    })
  })

  it('reads the connected account with a bearer token and validates the envelope', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input)
        headers = init?.headers as Record<string, string>
        return success({ user: { open_id: 'open_123', display_name: 'Tangle' } })
      }),
    )
    await expect(tiktokConnector.test(source())).resolves.toEqual({ ok: true })
    expect(url).toContain('/v2/user/info/?fields=')
    expect(url).toContain('open_id%2Cunion_id%2Cavatar_url%2Cdisplay_name')
    expect(headers.authorization).toBe('Bearer tiktok-access-token')
  })

  it('lists videos with bounded pagination and a fixed rich field set', async () => {
    let requestUrl = ''
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestBody = JSON.parse(String(init?.body))
        return success({ videos: [], cursor: 42, has_more: false })
      }),
    )
    await tiktokConnector.executeRead!({
      source: source(),
      capabilityName: 'videos.list',
      args: { cursor: 10, max_count: 20 },
      idempotencyKey: 'read-videos',
    })
    expect(requestUrl).toContain('/v2/video/list/?fields=')
    expect(requestUrl).toContain('view_count')
    expect(requestBody).toEqual({ cursor: 10, max_count: 20 })
  })

  it('queries at most 20 exact video ids through the documented filter body', async () => {
    let requestBody: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body))
        return success({ videos: [{ id: 'video_1' }] })
      }),
    )
    await tiktokConnector.executeRead!({
      source: source(),
      capabilityName: 'videos.query',
      args: { video_ids: ['video_1', 'video_2'] },
      idempotencyKey: 'read-video-ids',
    })
    expect(requestBody).toEqual({ filters: { video_ids: ['video_1', 'video_2'] } })
  })

  it('rejects HTTP-200 provider errors and malformed envelopes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {},
            error: {
              code: 'scope_not_authorized:tiktok-access-token',
              message: 'grant video.list; token=tiktok-access-token',
            },
          }),
          { status: 200 },
        ),
      ),
    )
    let providerError = ''
    try {
      await tiktokConnector.executeRead!({
        source: source(),
        capabilityName: 'videos.list',
        args: {},
        idempotencyKey: 'read-error',
      })
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error)
    }
    expect(providerError).toContain('scope_not_authorized')
    expect(providerError).toContain('[REDACTED]')
    expect(providerError).not.toContain('tiktok-access-token')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })),
    )
    await expect(tiktokConnector.test(source())).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no error status/),
    })
  })

  it('surfaces expired credentials without exposing the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('access_token_invalid', { status: 401 })),
    )
    await expect(
      tiktokConnector.executeRead!({
        source: source(),
        capabilityName: 'user.info',
        args: {},
        idempotencyKey: 'expired',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('preserves redacted TikTok policy errors returned as HTTP 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {},
            error: {
              code: 'url_ownership_unverified',
              message: 'token=tiktok-access-token',
            },
          }),
          { status: 403 },
        ),
      ),
    )
    let message = ''
    try {
      await tiktokConnector.executeRead!({
        source: source(),
        capabilityName: 'user.info',
        args: {},
        idempotencyKey: 'policy-error',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('url_ownership_unverified')
    expect(message).toContain('[REDACTED]')
    expect(message).not.toContain('tiktok-access-token')
    expect(message).not.toContain('rejected credentials')
  })
})

describe('TikTok direct publishing', () => {
  it('preflights creator limits and publishes one approved video from a verified URL', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        if (url.includes('/creator_info/query/')) return creatorInfo()
        return success({ publish_id: 'publish_video_1' })
      }),
    )

    const result = await tiktokConnector.executeMutation!({
      source: source(),
      capabilityName: 'publishing.videoFromUrl',
      args: {
        video_url: 'https://media.tangle.tools/video.mp4',
        video_duration_sec: 42,
        privacy_level: 'SELF_ONLY',
        title: 'A careful test post',
        disable_comment: true,
        disable_duet: false,
        disable_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: true,
        is_aigc: true,
      },
      idempotencyKey: 'publish-video-1',
    })

    expect(calls.map((call) => call.url)).toEqual([
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
    ])
    expect(calls[1]?.body).toEqual({
      post_info: {
        title: 'A careful test post',
        privacy_level: 'SELF_ONLY',
        disable_comment: true,
        disable_duet: false,
        disable_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: true,
        is_aigc: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: 'https://media.tangle.tools/video.mp4',
      },
    })
    expect(result.status).toBe('committed')
  })

  it('rejects an unavailable privacy level and an over-limit video before publishing', async () => {
    const fetchMock = vi.fn(async () =>
      creatorInfo({
        privacy_level_options: ['SELF_ONLY'],
        max_video_post_duration_sec: 60,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const invocation = {
      source: source(),
      capabilityName: 'publishing.videoFromUrl',
      args: {
        video_url: 'https://media.tangle.tools/video.mp4',
        video_duration_sec: 90,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      idempotencyKey: 'publish-video-rejected',
    }
    await expect(tiktokConnector.executeMutation!(invocation)).rejects.toThrow(
      /privacy_level PUBLIC_TO_EVERYONE is unavailable/,
    )
    expect(fetchMock).toHaveBeenCalledOnce()

    invocation.args.privacy_level = 'SELF_ONLY'
    await expect(tiktokConnector.executeMutation!(invocation)).rejects.toThrow(
      /duration 90s exceeds this creator's 60s limit/,
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects unsafe media URLs and invalid photo covers before network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      tiktokConnector.executeMutation!({
        source: source(),
        capabilityName: 'publishing.videoFromUrl',
        args: {
          video_url: 'http://media.tangle.tools/video.mp4',
          video_duration_sec: 30,
          privacy_level: 'SELF_ONLY',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        idempotencyKey: 'unsafe-video',
      }),
    ).rejects.toThrow(/valid HTTPS URL/)
    await expect(
      tiktokConnector.executeMutation!({
        source: source(),
        capabilityName: 'publishing.photosFromUrls',
        args: {
          photo_images: ['https://media.tangle.tools/photo.webp'],
          photo_cover_index: 1,
          privacy_level: 'SELF_ONLY',
          disable_comment: false,
          auto_add_music: false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        idempotencyKey: 'bad-cover',
      }),
    ).rejects.toThrow(/photo_cover_index/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes a photo carousel with required commercial-content declarations', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined)
        return String(input).includes('/creator_info/query/')
          ? creatorInfo()
          : success({ publish_id: 'publish_photos_1' })
      }),
    )
    await tiktokConnector.executeMutation!({
      source: source(),
      capabilityName: 'publishing.photosFromUrls',
      args: {
        photo_images: [
          'https://media.tangle.tools/one.webp',
          'https://media.tangle.tools/two.webp',
        ],
        photo_cover_index: 0,
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        title: 'Tangle update',
        description: 'Two release screenshots',
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: true,
      },
      idempotencyKey: 'publish-photos-1',
    })
    expect(bodies[1]).toEqual({
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title: 'Tangle update',
        description: 'Two release screenshots',
        privacy_level: 'SELF_ONLY',
        disable_comment: false,
        auto_add_music: false,
        brand_content_toggle: false,
        brand_organic_toggle: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: [
          'https://media.tangle.tools/one.webp',
          'https://media.tangle.tools/two.webp',
        ],
        photo_cover_index: 0,
      },
    })
  })

  it('rejects interaction choices that conflict with the latest creator settings', async () => {
    const fetchMock = vi.fn(async () =>
      creatorInfo({
        comment_disabled: true,
        duet_disabled: true,
        stitch_disabled: true,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      tiktokConnector.executeMutation!({
        source: source(),
        capabilityName: 'publishing.videoFromUrl',
        args: {
          video_url: 'https://media.tangle.tools/video.mp4',
          video_duration_sec: 30,
          privacy_level: 'SELF_ONLY',
          disable_comment: false,
          disable_duet: true,
          disable_stitch: true,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        idempotencyKey: 'creator-settings-conflict',
      }),
    ).rejects.toThrow(/disable_comment must be true/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('never reports a TikTok HTTP-200 publish error as committed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/creator_info/query/')) return creatorInfo()
        return new Response(
          JSON.stringify({
            data: {},
            error: {
              code: 'unaudited_client_can_only_post_to_private_accounts',
              message: 'use SELF_ONLY',
            },
          }),
          { status: 200 },
        )
      }),
    )
    await expect(
      tiktokConnector.executeMutation!({
        source: source(),
        capabilityName: 'publishing.videoFromUrl',
        args: {
          video_url: 'https://media.tangle.tools/video.mp4',
          video_duration_sec: 30,
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        idempotencyKey: 'provider-rejected',
      }),
    ).rejects.toThrow(/unaudited_client_can_only_post_to_private_accounts/)
  })

  it('never reports a publish response without a publish id as committed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/creator_info/query/')
          ? creatorInfo()
          : success({}),
      ),
    )
    await expect(
      tiktokConnector.executeMutation!({
        source: source(),
        capabilityName: 'publishing.videoFromUrl',
        args: {
          video_url: 'https://media.tangle.tools/video.mp4',
          video_duration_sec: 30,
          privacy_level: 'SELF_ONLY',
          disable_comment: false,
          disable_duet: false,
          disable_stitch: false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        idempotencyKey: 'missing-publish-id',
      }),
    ).rejects.toThrow(/invalid publish_id/)
  })
})
