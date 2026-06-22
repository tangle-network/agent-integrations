import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../adapter-provider.js'
import { IntegrationError } from '../index.js'
import type { ConnectorAdapter, TokenMetadataSource } from '../connectors/types.js'

const OWNER = { type: 'user' as const, id: 'user_42' }
const REDIRECT = 'https://app.example/oauth/callback'

function oauthAdapter(tokenMetadata?: Record<string, TokenMetadataSource>): ConnectorAdapter {
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
    })

    const url = new URL(result.authUrl)
    expect(url.origin + url.pathname).toBe('https://idp.example/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid_live')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('scope')).toBe('read:demo write:demo')
    expect(url.searchParams.get('state')).toBe('state_fixed_for_test')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(result.providerId).toBe('first-party')
    expect(result.connectorId).toBe('demo-oauth')
    expect(result.state).toBe('state_fixed_for_test')
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
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('the_code')
      expect(body.get('client_id')).toBe('cid_live')
      expect(body.get('client_secret')).toBe('sec_live')
      expect(body.get('redirect_uri')).toBe(REDIRECT)
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

  it('completeAuth surfaces a provider_failure when the IdP responds non-2xx', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{"error":"invalid_grant"}', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      }),
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
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(IntegrationError)
    expect((caught as IntegrationError).code).toBe('provider_failure')
    // The thrown message MUST NOT leak the client secret.
    expect((caught as Error).message).not.toContain('sec_live')
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
    })

    expect('instanceUrl' in (conn.metadata ?? {})).toBe(false)
  })
})
