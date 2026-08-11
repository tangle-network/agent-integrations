import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../adapter-provider.js'
import {
  validateConnectorManifest,
  type ConnectorAdapter,
  type OAuth2UrlTemplateMetadataSpec,
} from '../connectors/types.js'

const OWNER = { type: 'user' as const, id: 'user_42' }
const REDIRECT = 'https://app.example/oauth/callback'

function baseUrlOAuthAdapter(
  spec: OAuth2UrlTemplateMetadataSpec,
  key = 'providerRoot',
): ConnectorAdapter {
  return {
    manifest: {
      kind: 'base-url-oauth',
      displayName: 'Base URL OAuth',
      description: 'Adapter used to verify full provider URL metadata.',
      auth: {
        kind: 'oauth2',
        authorizationUrl: `{${key}}/oauth/authorize`,
        tokenUrl: `{${key}}/oauth/token`,
        scopes: [],
        clientIdEnv: 'BASE_URL_CLIENT_ID',
        clientSecretEnv: 'BASE_URL_CLIENT_SECRET',
        pkce: 'unsupported',
        urlTemplateMetadata: { [key]: spec },
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

function providerFor(spec: OAuth2UrlTemplateMetadataSpec, fetchImpl?: typeof fetch) {
  return createConnectorAdapterProvider({
    adapters: [baseUrlOAuthAdapter(spec)],
    resolveDataSource: () => ({ kind: 'base-url-oauth', id: 'ds_base_url' }) as never,
    resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}

async function startAuth(
  spec: OAuth2UrlTemplateMetadataSpec,
  providerRoot: unknown,
): Promise<string> {
  const provider = providerFor(spec)
  const started = await provider.startAuth!({
    connectorId: 'base-url-oauth',
    owner: OWNER,
    requestedScopes: [],
    redirectUri: REDIRECT,
    state: 'state_base_url',
    metadata: { providerRoot },
  })
  return started.authUrl
}

describe('OAuth provider base URL metadata', () => {
  it('rejects redirect and callback operations for a client-credentials contract', async () => {
    const adapter = baseUrlOAuthAdapter({
      kind: 'base-url',
      allowedBaseUrlSuffixes: ['.mktorest.com'],
    })
    if (adapter.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    adapter.manifest.auth.grantType = 'client_credentials'
    adapter.manifest.auth.authorizationUrl = undefined
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [adapter],
      resolveDataSource: () => ({ kind: 'base-url-oauth', id: 'ds_machine' }) as never,
      resolveOAuthClient: () => ({ clientId: 'cid_live', clientSecret: 'sec_live' }),
      fetchImpl,
    })

    await expect(provider.startAuth!({
      connectorId: 'base-url-oauth',
      owner: OWNER,
      requestedScopes: [],
      redirectUri: REDIRECT,
      metadata: { providerRoot: 'https://123-abc-456.mktorest.com' },
    })).rejects.toMatchObject({ code: 'auth_not_supported' })
    await expect(provider.completeAuth!({
      connectorId: 'base-url-oauth',
      owner: OWNER,
      code: 'must-not-be-used',
      state: 'state_machine',
      redirectUri: REDIRECT,
      metadata: { providerRoot: 'https://123-abc-456.mktorest.com' },
    })).rejects.toMatchObject({ code: 'auth_not_supported' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts an exact regional provider root for authorize and token requests', async () => {
    const spec: OAuth2UrlTemplateMetadataSpec = {
      kind: 'base-url',
      allowedBaseUrls: ['https://rest.apisandbox.zuora.com'],
    }
    const authUrl = await startAuth(spec, 'https://rest.apisandbox.zuora.com/')
    expect(new URL(authUrl).origin + new URL(authUrl).pathname).toBe(
      'https://rest.apisandbox.zuora.com/oauth/authorize',
    )

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: 'acc_xyz' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const provider = providerFor(spec, fetchImpl)
    await provider.completeAuth!({
      connectorId: 'base-url-oauth',
      owner: OWNER,
      code: 'code_xyz',
      state: 'state_base_url',
      redirectUri: REDIRECT,
      metadata: { providerRoot: 'https://rest.apisandbox.zuora.com' },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://rest.apisandbox.zuora.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('accepts a tenant root only under an allowed provider hostname suffix', async () => {
    const authUrl = await startAuth(
      { kind: 'base-url', allowedBaseUrlSuffixes: ['.snowflakecomputing.com'] },
      'https://xy12345.us-east-1.snowflakecomputing.com',
    )
    expect(new URL(authUrl).origin).toBe('https://xy12345.us-east-1.snowflakecomputing.com')
  })

  it('accepts a caller-selected public HTTPS root for a self-hosted provider', async () => {
    const authUrl = await startAuth(
      { kind: 'base-url', requirePublicHttps: true },
      'https://git.customer.example:8443',
    )
    expect(new URL(authUrl).origin).toBe('https://git.customer.example:8443')
  })

  it.each([
    ['missing', undefined, 'provider base URL'],
    ['non-string', 42, 'provider base URL'],
    ['plain text', 'git.customer.example', 'allowed HTTPS provider root'],
    ['HTTP', 'http://git.customer.example', 'allowed HTTPS provider root'],
    ['credentials', 'https://user:secret@git.customer.example', 'allowed HTTPS provider root'],
    ['path', 'https://git.customer.example/base', 'allowed HTTPS provider root'],
    ['query', 'https://git.customer.example/?tenant=acme', 'allowed HTTPS provider root'],
    ['fragment', 'https://git.customer.example/#oauth', 'allowed HTTPS provider root'],
    ['localhost', 'https://localhost', 'allowed HTTPS provider root'],
    ['localhost suffix', 'https://git.localhost', 'allowed HTTPS provider root'],
    ['local network name', 'https://git.local', 'allowed HTTPS provider root'],
    ['internal network name', 'https://git.internal', 'allowed HTTPS provider root'],
    ['home network name', 'https://git.home.arpa', 'allowed HTTPS provider root'],
    ['single-label host', 'https://gitea', 'allowed HTTPS provider root'],
    ['IPv4 literal', 'https://127.0.0.1', 'allowed HTTPS provider root'],
    ['IPv4 integer literal', 'https://2130706433', 'allowed HTTPS provider root'],
    ['IPv6 literal', 'https://[::1]', 'allowed HTTPS provider root'],
  ])('rejects an unsafe public provider root: %s', async (_label, providerRoot, message) => {
    await expect(startAuth(
      { kind: 'base-url', requirePublicHttps: true },
      providerRoot,
    )).rejects.toMatchObject({
      code: 'config_missing',
      message: expect.stringContaining(message),
    })
  })

  it.each([
    'https://snowflakecomputing.com',
    'https://xy12345.snowflakecomputing.com:8443',
    'https://xy12345.snowflakecomputing.com.attacker.test',
    'https://attacker.test',
  ])('rejects a host outside an allowed suffix: %s', async (providerRoot) => {
    await expect(startAuth(
      { kind: 'base-url', allowedBaseUrlSuffixes: ['.snowflakecomputing.com'] },
      providerRoot,
    )).rejects.toMatchObject({ code: 'config_missing' })
  })

  it('validates that each declared URL metadata rule is safe and used', () => {
    const unsafe = baseUrlOAuthAdapter({ kind: 'base-url' })
    const unused = baseUrlOAuthAdapter(
      { kind: 'base-url', allowedBaseUrlSuffixes: ['snowflakecomputing.com'] },
      'unusedRoot',
    )
    if (unused.manifest.auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    unused.manifest.auth.authorizationUrl = 'https://idp.example/authorize'
    unused.manifest.auth.tokenUrl = 'https://idp.example/token'

    expect(validateConnectorManifest(unsafe.manifest).issues.map((issue) => issue.message)).toContain(
      'OAuth base URL metadata requires an allowlist or public HTTPS policy',
    )
    expect(validateConnectorManifest(unused.manifest).issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'OAuth base URL hostname suffixes must start with a dot',
        'OAuth URL metadata is unused; add {unusedRoot} to an OAuth endpoint',
      ]),
    )
  })
})
