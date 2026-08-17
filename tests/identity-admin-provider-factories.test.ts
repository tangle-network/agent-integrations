import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  auth0Connector,
  CONNECTOR_ADAPTER_FACTORIES,
  oneloginConnector,
  oktaConnector,
  pingIdentityConnector,
  resolveConnectorAdapterFactoryOptions,
  scimConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const azureAdEnvMap = {
  clientId: [
    'AZURE_AD_OAUTH_CLIENT_ID',
    'MICROSOFT_OAUTH_CLIENT_ID',
    'MS_OAUTH_CLIENT_ID',
  ],
  clientSecret: [
    'AZURE_AD_OAUTH_CLIENT_SECRET',
    'MICROSOFT_OAUTH_CLIENT_SECRET',
    'MS_OAUTH_CLIENT_SECRET',
  ],
} as const

const auth0EnvMap = {
  clientId: 'AUTH0_OAUTH_CLIENT_ID',
  clientSecret: 'AUTH0_OAUTH_CLIENT_SECRET',
} as const

function auth0Source(tenantDomain: string): ResolvedDataSource {
  return {
    id: 'source_auth0',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'auth0',
    label: 'Auth0',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { tenantDomain },
    credentials: { kind: 'oauth2', accessToken: 'access-token' },
    status: 'active',
  }
}

describe('identity and administration provider factories', () => {
  it('registers Azure AD and Auth0 behind their exact OAuth application settings', () => {
    const azureAd = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'azure-ad',
    )
    const auth0 = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'auth0',
    )

    expect(azureAd?.envMap).toEqual(azureAdEnvMap)
    expect(auth0?.envMap).toEqual(auth0EnvMap)
    expect(azureAd?.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
    expect(auth0?.factory({}).manifest.capabilities.length).toBeGreaterThan(0)
  })

  it('registers Okta with customer-supplied tenant URL and API token credentials', () => {
    const okta = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'okta',
    )

    expect(okta?.envMap).toEqual({})
    expect(okta?.factory({})).toBe(oktaConnector)
    expect(resolveConnectorAdapterFactoryOptions(okta!, {})).toEqual({})
  })

  it('registers Ping Identity, OneLogin, and SCIM with connection-owned credentials', () => {
    for (const [kind, connector] of [
      ['ping-identity', pingIdentityConnector],
      ['onelogin', oneloginConnector],
      ['scim', scimConnector],
    ] as const) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition?.envMap).toEqual({})
      expect(definition?.factory({})).toBe(connector)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {})).toEqual({})
    }
  })

  it('accepts the shared Microsoft application for Azure AD and fails closed on partial OAuth settings', () => {
    const azureAd = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'azure-ad',
    )!
    const auth0 = CONNECTOR_ADAPTER_FACTORIES.find(
      (candidate) => candidate.kind === 'auth0',
    )!

    expect(resolveConnectorAdapterFactoryOptions(azureAd, {
      MICROSOFT_OAUTH_CLIENT_ID: 'client-id',
      MICROSOFT_OAUTH_CLIENT_SECRET: 'client-secret',
    })).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    expect(resolveConnectorAdapterFactoryOptions(azureAd, {
      AZURE_AD_OAUTH_CLIENT_ID: 'client-id-only',
    })).toBeNull()
    expect(resolveConnectorAdapterFactoryOptions(auth0, {
      AUTH0_OAUTH_CLIENT_ID: 'client-id-only',
    })).toBeNull()
  })

  it('keeps identity catalog entries without direct adapters out of the executable inventory', () => {
    const executableKinds = new Set(
      CONNECTOR_ADAPTER_FACTORIES.map((definition) => definition.kind),
    )

    for (const kind of [
      'google-directory',
      'saml',
    ]) {
      expect(executableKinds.has(kind), kind).toBe(false)
    }
  })
})

describe('Auth0 tenant URL boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows Auth0 tenant hosts and rejects lookalike credential-exfiltration hosts', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(auth0Connector.test(
      auth0Source('https://acme.us.auth0.com'),
    )).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://acme.us.auth0.com/api/v2/stats/active-users')

    await expect(auth0Connector.test(
      auth0Source('https://acme.us.auth0.com.attacker.test'),
    )).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
  })
})
