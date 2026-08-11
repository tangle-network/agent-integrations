import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../adapter-provider.js'
import { IntegrationError } from '../index.js'
import type { ConnectorAdapter, TokenMetadataSource } from '../connectors/types.js'

const OWNER = { type: 'user' as const, id: 'user_42' }
const REDIRECT = 'https://app.example/oauth/callback'
const PKCE_CHALLENGE = 'c'.repeat(43)
const PKCE_VERIFIER = 'v'.repeat(64)

function oauthAdapter(
  tokenMetadata?: Record<string, TokenMetadataSource>,
  pkce?: 'required' | 'supported' | 'unsupported',
): ConnectorAdapter {
  return {
    manifest: {
      kind: 'demo-oauth',
      displayName: 'Demo OAuth',
      description: 'Adapter used by adapter-provider OAuth tests.',
      auth: {
        kind: 'oauth2',
        authorizationUrl: 'https://idp.example/authorize',
        tokenUrl: 'https://idp.example/token',
        scopes: ['read:demo', 'write:demo'],
        clientIdEnv: 'DEMO_CLIENT_ID',
        clientSecretEnv: 'DEMO_CLIENT_SECRET',
        extraAuthParams: { access_type: 'offline' },
        ...(pkce ? { pkce } : {}),
        ...(tokenMetadata ? { tokenMetadata } : {}),
      },
      capabilities: [],
      defaultConsistencyModel: 'authoritative',
      category: 'other',
    },
    async test() {
      return { ok: true }
    },
  }
}

function apiKeyAdapter(): ConnectorAdapter {
  return {
    manifest: {
      kind: 'demo-api-key',
      displayName: 'Demo API Key',
      description: 'Adapter used to verify auth_not_supported branch.',
      auth: { kind: 'api-key', hint: 'paste your key' },
      capabilities: [],
      defaultConsistencyModel: 'authoritative',
      category: 'other',
    },
    async test() {
      return { ok: true }
    },
  }
}

function tenantOAuthAdapter(): ConnectorAdapter {
  const adapter = oauthAdapter()
  if (adapter.manifest.auth.kind !== 'oauth2') throw new Error('expected oauth2 adapter')
  return {
    ...adapter,
    manifest: {
      ...adapter.manifest,
      kind: 'tenant-oauth',
      auth: {
        ...adapter.manifest.auth,
        authorizationUrl: 'https://{shop}.provider.example/oauth/authorize',
        tokenUrl: 'https://{shop}.provider.example/oauth/token',
      },
    },
  }
}

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createConnectorAdapterProvider OAuth flow', () => {
  it('startAuth builds an authorization URL with every required param', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
    })

    const result = await provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      state: 'state_fixed_for_test',
      codeChallenge: PKCE_CHALLENGE,
    })

    const url = new URL(result.authUrl)
    expect(url.origin + url.pathname).toBe('https://idp.example/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid_live')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('scope')).toBe('read:demo write:demo')
    expect(url.searchParams.get('state')).toBe('state_fixed_for_test')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge')).toBe(PKCE_CHALLENGE)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(result.providerId).toBe('first-party')
    expect(result.connectorId).toBe('demo-oauth')
    expect(result.state).toBe('state_fixed_for_test')
    expect((await provider.listConnectors())[0]?.metadata?.oauthPkce).toBe('required')
  })

  it('fails closed before provider traffic when the default PKCE fields are missing', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    await expect(provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
    })).rejects.toMatchObject({ code: 'config_missing' })
    await expect(provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
    })).rejects.toMatchObject({ code: 'config_missing' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses PKCE when the provider declares it supported', async () => {
    let tokenBody: URLSearchParams | undefined
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter(undefined, 'supported')],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl: vi.fn(async (_url, init) => {
        tokenBody = init?.body as URLSearchParams
        return tokenResponse({ access_token: 'acc_xyz' })
      }) as unknown as typeof fetch,
    })

    const started = await provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      codeChallenge: PKCE_CHALLENGE,
    })
    expect(new URL(started.authUrl).searchParams.get('code_challenge')).toBe(PKCE_CHALLENGE)
    await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: started.state,
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })
    expect(tokenBody?.get('code_verifier')).toBe(PKCE_VERIFIER)
    expect((await provider.listConnectors())[0]?.metadata?.oauthPkce).toBe('supported')
  })

  it('omits caller-supplied PKCE fields when the provider declares them unsupported', async () => {
    let tokenBody: URLSearchParams | undefined
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter(undefined, 'unsupported')],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl: vi.fn(async (_url, init) => {
        tokenBody = init?.body as URLSearchParams
        return tokenResponse({ access_token: 'acc_xyz' })
      }) as unknown as typeof fetch,
    })

    const started = await provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      codeChallenge: 'caller-must-not-force-pkce',
    })
    const authUrl = new URL(started.authUrl)
    expect(authUrl.searchParams.has('code_challenge')).toBe(false)
    expect(authUrl.searchParams.has('code_challenge_method')).toBe(false)
    await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: started.state,
      redirectUri: REDIRECT,
      codeVerifier: 'caller-must-not-force-pkce',
    })
    expect(tokenBody?.has('code_verifier')).toBe(false)
    expect((await provider.listConnectors())[0]?.metadata?.oauthPkce).toBe('unsupported')
  })

  it('resolves a tenant OAuth hostname from a validated metadata label', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse({ access_token: 'acc_xyz' })) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [tenantOAuthAdapter()],
      resolveDataSource: () => ({ kind: 'tenant-oauth', id: 'ds_tenant' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    const started = await provider.startAuth!({
      connectorId: 'tenant-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      state: 'state_tenant',
      codeChallenge: PKCE_CHALLENGE,
      metadata: { shop: 'Acme-Store' },
    })
    expect(new URL(started.authUrl).hostname).toBe('acme-store.provider.example')

    await provider.completeAuth!({
      connectorId: 'tenant-oauth',
      owner: OWNER,
      code: 'code_tenant',
      state: 'state_tenant',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
      metadata: { shop: 'Acme-Store' },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://acme-store.provider.example/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it.each([
    [{}, 'requires metadata.shop'],
    [{ shop: 'acme.provider.example' }, 'valid tenant label'],
    [{ shop: 'acme@attacker.test' }, 'valid tenant label'],
    [{ shop: '-acme' }, 'valid tenant label'],
  ])('rejects missing or unsafe tenant OAuth metadata', async (metadata, message) => {
    const provider = createConnectorAdapterProvider({
      adapters: [tenantOAuthAdapter()],
      resolveDataSource: () => ({ kind: 'tenant-oauth', id: 'ds_tenant' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
    })

    await expect(provider.startAuth!({
      connectorId: 'tenant-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      metadata,
    })).rejects.toMatchObject({ code: 'config_missing', message: expect.stringContaining(message) })
  })

  it('startAuth refuses non-oauth2 (api-key) adapters with auth_not_supported', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [apiKeyAdapter()],
      resolveDataSource: () => ({ kind: 'demo-api-key', id: 'ds_x' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid', clientSecret: 'sec' }),
    })

    await expect(
      provider.startAuth!({
        connectorId: 'demo-api-key',
        owner: OWNER,
        requestedScopes: [],
        redirectUri: REDIRECT,
      }),
    ).rejects.toMatchObject({ code: 'auth_not_supported' })
  })

  it('startAuth fails with config_missing when resolveOAuthClient returns null', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => null,
    })

    await expect(
      provider.startAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        requestedScopes: [],
        redirectUri: REDIRECT,
      }),
    ).rejects.toMatchObject({ code: 'config_missing' })
  })

  it('completeAuth POSTs form-encoded body and returns an active connection', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://idp.example/token')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['content-type']).toBe(
        'application/x-www-form-urlencoded',
      )
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined()
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('the_code')
      expect(body.get('client_id')).toBe('cid_live')
      expect(body.get('client_secret')).toBe('sec_live')
      expect(body.get('redirect_uri')).toBe(REDIRECT)
      expect(body.get('code_verifier')).toBe(PKCE_VERIFIER)
      return tokenResponse({
        access_token: 'acc_xyz',
        refresh_token: 'ref_xyz',
        expires_in: 3600,
        scope: 'read:demo write:demo',
        token_type: 'Bearer',
      })
    }) as unknown as typeof fetch

    const fixedNow = new Date('2026-06-01T12:00:00.000Z')
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
      now: () => fixedNow,
    })

    const conn = await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(conn.owner).toEqual(OWNER)
    expect(conn.providerId).toBe('first-party')
    expect(conn.connectorId).toBe('demo-oauth')
    expect(conn.status).toBe('active')
    expect(conn.grantedScopes).toEqual(['read:demo', 'write:demo'])
    expect(conn.createdAt).toBe(fixedNow.toISOString())
    expect(conn.updatedAt).toBe(fixedNow.toISOString())
    expect(conn.expiresAt).toBe(new Date(fixedNow.getTime() + 3600 * 1000).toISOString())
    expect(conn.id).toMatch(/^conn_/)
  })

  it('completeAuth sends client_secret_basic credentials only in the Authorization header', async () => {
    const basicAdapter = oauthAdapter()
    if (basicAdapter.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    basicAdapter.manifest.auth.tokenClientAuthMethod = 'client_secret_basic'
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://idp.example/token')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers).toEqual({
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: 'Basic Y2lkX2xpdmU6c2VjX2xpdmU=',
      })
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('the_code')
      expect(body.get('redirect_uri')).toBe(REDIRECT)
      expect(body.get('code_verifier')).toBe(PKCE_VERIFIER)
      expect(body.has('client_id')).toBe(false)
      expect(body.has('client_secret')).toBe(false)
      return tokenResponse({ access_token: 'acc_xyz' })
    }) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [basicAdapter],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('supports a PKCE public client with a client id and no secret', async () => {
    const publicAdapter = oauthAdapter()
    if (publicAdapter.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    publicAdapter.manifest.auth.tokenClientAuthMethod = 'none'
    delete publicAdapter.manifest.auth.clientSecretEnv
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('https://idp.example/token')
      expect((init?.headers as Record<string, string>).authorization).toBeUndefined()
      const body = init?.body as URLSearchParams
      expect(body.get('client_id')).toBe('cid_public')
      expect(body.has('client_secret')).toBe(false)
      expect(body.get('code_verifier')).toBe(PKCE_VERIFIER)
      return tokenResponse({ access_token: 'acc_public' })
    }) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [publicAdapter],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({
        clientId: 'cid_public',
        clientSecret: 'must-not-send',
      }),
      fetchImpl,
    })

    const started = await provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      codeChallenge: PKCE_CHALLENGE,
    })
    expect(new URL(started.authUrl).searchParams.get('client_id')).toBe('cid_public')
    expect(new URL(started.authUrl).searchParams.get('code_challenge')).toBe(PKCE_CHALLENGE)
    await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: started.state,
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails closed when a confidential client resolver omits the secret', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live' }),
      fetchImpl,
    })

    await expect(provider.startAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      codeChallenge: PKCE_CHALLENGE,
    })).rejects.toMatchObject({ code: 'config_missing' })
    await expect(provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })).rejects.toMatchObject({ code: 'config_missing' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('redacts encoded client_secret_basic credentials from token-exchange failures', async () => {
    const basicAdapter = oauthAdapter()
    if (basicAdapter.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    basicAdapter.manifest.auth.tokenClientAuthMethod = 'client_secret_basic'
    const authorization = 'Basic Y2lkX2xpdmU6c2VjX2xpdmU='
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: 'invalid_client', detail: authorization }),
      { status: 401, statusText: 'Unauthorized' },
    )) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [basicAdapter],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    let caught: unknown
    try {
      await provider.completeAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        code: 'the_code',
        state: 'state_xyz',
        redirectUri: REDIRECT,
        codeVerifier: PKCE_VERIFIER,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      code: 'provider_failure',
      message: expect.stringContaining('[REDACTED]'),
    })
    expect((caught as Error).message).not.toContain(authorization)
  })

  it('fails closed before fetching when an adapter supplies an unknown token client authentication method', async () => {
    const malformedAdapter = oauthAdapter()
    if (malformedAdapter.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    malformedAdapter.manifest.auth.tokenClientAuthMethod = 'not-a-real-method' as never
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [malformedAdapter],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    await expect(provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
    })).rejects.toMatchObject({
      code: 'config_missing',
      message: expect.stringContaining('unsupported OAuth token client authentication method'),
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('completeAuth surfaces a provider_failure when the IdP responds non-2xx', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        '{"error":"invalid_grant","echo":"cid_live sec_live bad_code"}',
        {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    let caught: unknown
    try {
      await provider.completeAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        code: 'bad_code',
        state: 'state_xyz',
        redirectUri: REDIRECT,
        codeVerifier: PKCE_VERIFIER,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IntegrationError)
    expect((caught as IntegrationError).code).toBe('provider_failure')
    expect((caught as Error).message).toContain('[REDACTED]')
    expect((caught as Error).message).not.toContain('cid_live')
    expect((caught as Error).message).not.toContain('sec_live')
    expect((caught as Error).message).not.toContain('bad_code')
  })

  it('completeAuth redacts credentials from token-exchange transport errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('request failed with cid_live sec_live bad_code')
    }) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    let caught: unknown
    try {
      await provider.completeAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        code: 'bad_code',
        state: 'state_xyz',
        redirectUri: REDIRECT,
        codeVerifier: PKCE_VERIFIER,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(IntegrationError)
    expect((caught as Error).message).toContain('[REDACTED]')
    expect((caught as Error).message).not.toContain('cid_live')
    expect((caught as Error).message).not.toContain('sec_live')
    expect((caught as Error).message).not.toContain('bad_code')
  })

  it('completeAuth rejects when the token response is missing access_token', async () => {
    const fetchImpl = vi.fn(async () => tokenResponse({ token_type: 'Bearer' })) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter()],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    await expect(
      provider.completeAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        code: 'the_code',
        state: 'state_xyz',
        redirectUri: REDIRECT,
        codeVerifier: PKCE_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: 'provider_failure' })
  })

  it('completeAuth captures declared tokenMetadata fields (string + object form), merging with — and overriding same-key — request.metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({
        access_token: 'acc_xyz',
        token_type: 'Bearer',
        // Provider-specific fields the standard parser would otherwise drop.
        api_base_url_for_customer: 'https://company-17.api.gong.io',
        instance_url: 'https://eu.example.com',
      }),
    ) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [
        oauthAdapter({
          // object form (required) + string shorthand
          apiBaseUrlForCustomer: { field: 'api_base_url_for_customer', required: true },
          instanceUrl: 'instance_url',
        }),
      ],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    const conn = await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
      // `tenant` is a non-colliding key → preserved (merge, not replace).
      // `apiBaseUrlForCustomer` collides → the token-exchange value is
      // authoritative and MUST win over the stale request.metadata value.
      metadata: { tenant: 'acme', apiBaseUrlForCustomer: 'https://stale.example' },
    })

    expect(conn.metadata).toEqual({
      tenant: 'acme',
      apiBaseUrlForCustomer: 'https://company-17.api.gong.io',
      instanceUrl: 'https://eu.example.com',
    })
  })

  it('completeAuth omits a non-required tokenMetadata field that is absent (capture-if-present)', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'acc_xyz', token_type: 'Bearer' }),
    ) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter({ instanceUrl: 'instance_url' })],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    const conn = await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })

    expect(conn.metadata).toEqual({})
    expect('instanceUrl' in (conn.metadata ?? {})).toBe(false)
  })

  it('completeAuth fails loud (provider_failure) when a required tokenMetadata field is absent', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'acc_xyz', token_type: 'Bearer' }),
    ) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter({ apiBaseUrlForCustomer: { field: 'api_base_url_for_customer', required: true } })],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    let caught: unknown
    try {
      await provider.completeAuth!({
        connectorId: 'demo-oauth',
        owner: OWNER,
        code: 'the_code',
        state: 'state_xyz',
        redirectUri: REDIRECT,
        codeVerifier: PKCE_VERIFIER,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IntegrationError)
    expect((caught as IntegrationError).code).toBe('provider_failure')
    expect((caught as Error).message).toMatch(/api_base_url_for_customer/)
  })

  it('completeAuth treats a present-but-empty required tokenMetadata field as absent and fails loud', async () => {
    // Locks the `=== ''` (post-trim) emptiness guard against a regression to a
    // null-only check that would mint an active connection whose every call 404s.
    for (const emptyish of ['', '   ', '\n\t']) {
      const fetchImpl = vi.fn(async () =>
        tokenResponse({ access_token: 'acc_xyz', token_type: 'Bearer', api_base_url_for_customer: emptyish }),
      ) as unknown as typeof fetch

      const provider = createConnectorAdapterProvider({
        adapters: [oauthAdapter({ apiBaseUrlForCustomer: { field: 'api_base_url_for_customer', required: true } })],
        resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
        resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
        fetchImpl,
      })

      await expect(
        provider.completeAuth!({
          connectorId: 'demo-oauth',
          owner: OWNER,
          code: 'the_code',
          state: 'state_xyz',
          redirectUri: REDIRECT,
          codeVerifier: PKCE_VERIFIER,
        }),
      ).rejects.toMatchObject({ code: 'provider_failure' })
    }
  })

  it('completeAuth omits a non-required tokenMetadata field that is present but empty/whitespace', async () => {
    const fetchImpl = vi.fn(async () =>
      tokenResponse({ access_token: 'acc_xyz', token_type: 'Bearer', instance_url: '   ' }),
    ) as unknown as typeof fetch

    const provider = createConnectorAdapterProvider({
      adapters: [oauthAdapter({ instanceUrl: 'instance_url' })],
      resolveDataSource: () => ({ kind: 'demo-oauth', id: 'ds_demo' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    const conn = await provider.completeAuth!({
      connectorId: 'demo-oauth',
      owner: OWNER,
      code: 'the_code',
      state: 'state_xyz',
      redirectUri: REDIRECT,
      codeVerifier: PKCE_VERIFIER,
    })

    expect('instanceUrl' in (conn.metadata ?? {})).toBe(false)
  })
})
