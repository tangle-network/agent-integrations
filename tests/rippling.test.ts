import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/adapter-provider.js'
import { ripplingConnector } from '../src/connectors/adapters/rippling.js'

const owner = { type: 'user' as const, id: 'user_rippling' }
const redirectUri = 'https://id.tangle.tools/api/integrations/oauth/rippling/callback'

function provider(fetchImpl?: typeof fetch) {
  return createConnectorAdapterProvider({
    adapters: [ripplingConnector],
    resolveDataSource: () => ({ kind: 'rippling', id: 'ds_rippling' }) as never,
    resolveOAuthClient: () => ({
      clientId: 'rippling-client',
      clientSecret: 'rippling-secret',
    }),
    ...(fetchImpl ? { fetchImpl } : {}),
  })
}

describe('rippling adapter manifest', () => {
  it('exposes the rippling kind, "other" category, and authoritative consistency', () => {
    expect(ripplingConnector.manifest.kind).toBe('rippling')
    expect(ripplingConnector.manifest.category).toBe('other')
    expect(ripplingConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth with Rippling app.rippling.com endpoints + workforce scopes', () => {
    const auth = ripplingConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://app.rippling.com/apps/PLATFORM/{appName}/authorize')
    expect(auth.tokenUrl).toBe('https://api.rippling.com/api/o/token/')
    expect(auth.clientIdEnv).toBe('RIPPLING_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('RIPPLING_OAUTH_CLIENT_SECRET')
    expect(auth.tokenClientAuthMethod).toBe('client_secret_basic')
    expect(auth.pkce).toBe('unsupported')
    expect(auth.urlTemplateMetadata).toEqual({
      appName: { kind: 'path-segment' },
    })
    expect(auth.scopes).toContain('company:read')
    expect(auth.scopes).toContain('employees:read')
    expect(auth.scopes).toContain('employees:write')
  })

  it('renders the deployed app name and exchanges the code with HTTP Basic auth', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: 'rippling-access',
      refresh_token: 'rippling-refresh',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const adapterProvider = provider(fetchMock as unknown as typeof fetch)

    const started = await adapterProvider.startAuth!({
      connectorId: 'rippling',
      owner,
      requestedScopes: [],
      redirectUri,
      state: 'state_rippling',
      metadata: { appName: 'tangleintegrationhub80a33' },
    })
    const authorizationUrl = new URL(started.authUrl)
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://app.rippling.com/apps/PLATFORM/tangleintegrationhub80a33/authorize',
    )
    expect(authorizationUrl.searchParams.get('client_id')).toBe('rippling-client')
    expect(authorizationUrl.searchParams.has('code_challenge')).toBe(false)

    await adapterProvider.completeAuth!({
      connectorId: 'rippling',
      owner,
      code: 'rippling-code',
      state: started.state,
      redirectUri,
      metadata: { appName: 'tangleintegrationhub80a33' },
    })

    const [tokenUrl, init] = fetchMock.mock.calls[0]!
    expect(tokenUrl).toBe('https://api.rippling.com/api/o/token/')
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${btoa('rippling-client:rippling-secret')}`,
    )
    const body = init?.body as URLSearchParams
    expect(body.get('client_id')).toBeNull()
    expect(body.get('client_secret')).toBeNull()
  })

  it.each([
    undefined,
    'tangle/integration-hub',
    'tangle?next=attacker',
  ])('rejects a missing or unsafe deployed app name before redirect: %s', async (appName) => {
    await expect(provider().startAuth!({
      connectorId: 'rippling',
      owner,
      requestedScopes: [],
      redirectUri,
      metadata: { appName },
    })).rejects.toMatchObject({ code: 'config_missing' })
  })

  it('covers company, employees, groups, departments, work locations, teams, and activity', () => {
    const names = ripplingConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'company.get',
        'me.get',
        'employees.list',
        'employees.get',
        'employees.update',
        'groups.list',
        'groups.get',
        'departments.list',
        'departments.get',
        'work_locations.list',
        'work_locations.get',
        'teams.list',
        'company_activity.list',
      ].sort(),
    )
  })

  it('classifies reads vs the single employees.update mutation correctly', () => {
    const reads = ripplingConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = ripplingConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['employees.update'])
    expect(reads).toHaveLength(12)
  })

  it('uses optimistic-read-verify CAS for employees.update (PATCH against authoritative HRIS data)', () => {
    const update = ripplingConnector.manifest.capabilities.find((c) => c.name === 'employees.update')
    if (!update || update.class !== 'mutation') throw new Error('expected mutation employees.update')
    expect(update.cas).toBe('optimistic-read-verify')
  })
})
