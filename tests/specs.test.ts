import { describe, expect, it } from 'vitest'
import {
  buildHealthcheckPlan,
  bundledAuthMode,
  bundledOAuth2AuthContract,
  getBundledAdapterManifest,
  getIntegrationSpec,
  hasBundledAdapter,
  integrationSpecToConnector,
  listExecutableIntegrationSpecs,
  listIntegrationCoverageSpecs,
  listIntegrationSpecs,
  renderAgentToolDescription,
  renderConsoleSteps,
  renderRunbookMarkdown,
  resolveConnectorAuthSpec,
  validateCredentialFormat,
  validateIntegrationSpec,
} from '../src/index'

describe('integration specs', () => {
  it('derives one setup spec per coverage catalog entry', () => {
    const specs = listIntegrationSpecs()
    expect(specs).toHaveLength(listIntegrationCoverageSpecs().length)
    expect(new Set(specs.map((spec) => spec.kind)).size).toBe(specs.length)
    expect(specs.length).toBeGreaterThanOrEqual(140)
  })

  it('models executable OAuth and API-key connectors without conflating auth modes', () => {
    const google = getIntegrationSpec('google-calendar')
    const github = getIntegrationSpec('github')
    const webhook = getIntegrationSpec('webhook')

    expect(google?.status).toBe('executable')
    expect(google?.auth.mode).toBe('oauth2')
    expect(google?.permissions.some((p) => p.providerScopes.includes('https://www.googleapis.com/auth/calendar'))).toBe(true)

    expect(github?.status).toBe('executable')
    expect(github?.auth.mode).toBe('api_key')

    expect(webhook?.status).toBe('executable')
    expect(webhook?.auth.mode).toBe('hmac')
  })

  it('renders setup surfaces from the same spec source', () => {
    const spec = getIntegrationSpec('google-calendar')
    expect(spec).toBeDefined()
    const steps = renderConsoleSteps(spec!, { host: 'builder.example.com' })
    const markdown = renderRunbookMarkdown(spec!, { host: 'builder.example.com' })
    const toolDescription = renderAgentToolDescription(spec!)

    expect(steps.some((step) => step.detail.includes('builder.example.com'))).toBe(true)
    expect(markdown).toContain('# Google Calendar Integration Setup')
    expect(markdown).toContain('https://builder.example.com/api/integrations/oauth/google/callback')
    expect(toolDescription).toContain('Google Calendar')
  })

  it('validates specs, credential formats, healthchecks, and connector conversion', () => {
    const spec = getIntegrationSpec('salesforce')
    expect(spec).toBeDefined()
    expect(validateIntegrationSpec(spec!).ok).toBe(true)
    expect(buildHealthcheckPlan(spec!).requires).toContain('connection_credentials')

    const connector = integrationSpecToConnector(spec!, 'first-party')
    expect(connector.auth).toBe('oauth2')
    expect(connector.actions.length).toBeGreaterThan(0)

    const field = spec!.setup.credentialFields.find((f) => !f.secret)
    expect(field).toBeDefined()
    expect(validateCredentialFormat(field!, 'abc').ok).toBe(true)
  })

  it('resolves a connect-driving auth spec per provider from the spec catalog', () => {
    const google = resolveConnectorAuthSpec('google-calendar')
    expect(google).toMatchObject({
      kind: 'google-calendar',
      authKind: 'oauth2',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      pkce: 'supported',
      tokenClientAuthMethod: 'client_secret_post',
    })
    expect(google!.requestedScopes).toContain('https://www.googleapis.com/auth/calendar')
    expect(google!.requestedScopes.every((scope) => scope.length > 0)).toBe(true)

    const clickup = resolveConnectorAuthSpec('clickup')
    expect(clickup).toMatchObject({
      kind: 'clickup',
      authKind: 'oauth2',
      authorizationUrl: 'https://app.clickup.com/api',
      tokenUrl: 'https://api.clickup.com/api/v2/oauth/token',
      pkce: 'required',
      tokenClientAuthMethod: 'client_secret_post',
      requestedScopes: [],
    })

    for (const kind of ['slack', 'hubspot', 'salesforce']) {
      expect(resolveConnectorAuthSpec(kind)?.pkce, kind).toBe('required')
    }
    expect(resolveConnectorAuthSpec('tiktok')?.pkce).toBe('unsupported')

    const calCom = resolveConnectorAuthSpec('cal-com')
    expect(calCom).toMatchObject({
      authKind: 'oauth2',
      clientIdEnv: 'CALCOM_OAUTH_CLIENT_ID',
      pkce: 'required',
      tokenClientAuthMethod: 'none',
    })
    expect(calCom?.clientSecretEnv).toBeUndefined()
    expect(getIntegrationSpec('cal-com')?.setup.credentialFields).toEqual([
      expect.objectContaining({ label: 'Client ID', secret: false }),
    ])

    const github = resolveConnectorAuthSpec('github')
    expect(github).toEqual({ kind: 'github', authKind: 'api_key', requestedScopes: [] })

    const http = resolveConnectorAuthSpec('http')
    expect(http).toEqual({ kind: 'http', authKind: 'none', requestedScopes: [] })

    // hmac-family providers surface as 'custom' (not in the four hub-driveable
    // kinds the OAuth start path handles directly).
    const webhook = resolveConnectorAuthSpec('webhook')
    expect(webhook).toEqual({ kind: 'webhook', authKind: 'custom', requestedScopes: [] })

    expect(resolveConnectorAuthSpec('definitely-not-a-real-kind')).toBeUndefined()
  })

  it('resolves auth specs through kind aliases', () => {
    // 'notion-database' aliases to 'notion'; 'stripe' to 'stripe-pack'.
    expect(resolveConnectorAuthSpec('notion')?.kind).toBe('notion')
    expect(resolveConnectorAuthSpec('stripe')?.authKind).toBe('api_key')
  })

  it('derives executable status from the shipped adapter, not a hand-kept list', () => {
    const executable = listExecutableIntegrationSpecs().map((spec) => spec.kind).sort()
    expect(executable).toEqual(expect.arrayContaining([
      'airtable',
      'asana',
      'github',
      'google-calendar',
      'google-sheets',
      'hubspot',
      'microsoft-calendar',
      'salesforce',
      'slack',
    ]))
    // gmail ships a real adapter (src/connectors/adapters/gmail.ts, registered
    // in CONNECTOR_ADAPTER_FACTORIES). It reported 'catalog' for as long as
    // status came from a hand-maintained set that nobody updated when the
    // adapter landed — the assertion that pinned it there was encoding the
    // drift, not guarding against it.
    expect(getIntegrationSpec('gmail')?.status).toBe('executable')

    // Every spec's status must agree with adapter reality, in both directions.
    for (const spec of listIntegrationSpecs()) {
      const backed = hasBundledAdapter(spec.kind)
      expect(
        { kind: spec.kind, status: spec.status },
        `${spec.kind} status must follow adapter presence (hasBundledAdapter=${backed})`,
      ).toEqual({ kind: spec.kind, status: backed ? 'executable' : 'catalog' })
    }
  })

  it('never advertises an unresolvable authorization URL', () => {
    // `.invalid` is a reserved TLD (RFC 2606) — it can never resolve. Wiring
    // it behind a Connect button makes a dead integration look identical to a
    // working one, which is the failure this guards. An integration nothing
    // can authenticate must expose NO url rather than a fake one.
    const oauth = listIntegrationSpecs().filter((spec) => spec.auth.mode === 'oauth2')
    expect(oauth.length).toBeGreaterThan(50)
    for (const spec of oauth) {
      if (spec.auth.mode !== 'oauth2') continue
      for (const url of [spec.auth.authorizationUrl, spec.auth.tokenUrl]) {
        if (url === undefined) continue
        expect(url, `${spec.kind} advertises a placeholder endpoint`).not.toContain('example.invalid')
        let resolved = url
        for (const match of url.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)) {
          const key = match[1]!
          const policy = spec.auth.urlTemplateMetadata?.[key]
          const value = policy
            ? policy.allowedBaseUrls?.[0]
              ?? (policy.allowedBaseUrlSuffixes?.[0]
                ? `https://tenant${policy.allowedBaseUrlSuffixes[0]}`
                : 'https://provider.example')
            : 'tenant'
          resolved = resolved.replaceAll(match[0], value)
        }
        expect(() => new URL(resolved), `${spec.kind} endpoint must parse after safe metadata`).not.toThrow()
        expect(new URL(resolved).protocol, `${spec.kind} endpoint must be https`).toBe('https:')
      }
    }
  })

  it('exports machine grants and provider-root URL policies to connect runtimes', () => {
    const authContract = (kind: string) => {
      const manifest = getBundledAdapterManifest(kind)
      expect(manifest, `missing bundled manifest for ${kind}`).toBeDefined()
      return bundledOAuth2AuthContract(manifest!)
    }

    expect(authContract('marketo')).toMatchObject({
      grantType: 'client_credentials',
      authorizationUrl: undefined,
      tokenUrl: '{restEndpoint}/identity/oauth/token',
      urlTemplateMetadata: {
        restEndpoint: {
          kind: 'base-url',
          allowedBaseUrlSuffixes: ['.mktorest.com'],
        },
      },
    })
    expect(authContract('zuora')).toMatchObject({
      grantType: 'client_credentials',
      authorizationUrl: undefined,
      tokenUrl: '{apiBaseUrl}/oauth/token',
      urlTemplateMetadata: {
        apiBaseUrl: {
          kind: 'base-url',
          allowedBaseUrls: expect.arrayContaining([
            'https://rest.zuora.com',
            'https://rest.eu.zuora.com',
            'https://rest.ap.zuora.com',
          ]),
        },
      },
    })
    expect(authContract('gitea')).toMatchObject({
      grantType: 'authorization_code',
      authorizationUrl: '{instanceUrl}/login/oauth/authorize',
      urlTemplateMetadata: {
        instanceUrl: { kind: 'base-url', requirePublicHttps: true },
      },
    })
    expect(authContract('snowflake')).toMatchObject({
      grantType: 'authorization_code',
      authorizationUrl: '{accountUrl}/oauth/authorize',
      urlTemplateMetadata: {
        accountUrl: {
          kind: 'base-url',
          allowedBaseUrlSuffixes: ['.snowflakecomputing.com'],
        },
      },
    })
  })

  it('an executable oauth2 spec can actually start a connect flow', () => {
    // status:'executable' is a promise that the connect flow has somewhere to
    // go. Without this, deriving status from adapter presence could still hand
    // the hub an endpoint-less spec. `client_credentials` providers are the
    // one legitimate exception — machine-to-machine grants have no authorize
    // step by design — so they are checked for a token endpoint only.
    let checked = 0
    for (const spec of listExecutableIntegrationSpecs()) {
      if (spec.auth.mode !== 'oauth2') continue
      const manifest = getBundledAdapterManifest(spec.kind)
      const resolved = resolveConnectorAuthSpec(spec.kind)
      expect(resolved?.tokenUrl, `${spec.kind} is executable but has no token endpoint`).toBeTruthy()
      if (manifest && bundledAuthMode(manifest) === 'oauth2_client_credentials') continue
      expect(resolved?.authorizationUrl, `${spec.kind} is executable but has no authorize endpoint`).toBeTruthy()
      checked += 1
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('reports the auth mode the adapter really implements', () => {
    // Coda is an api-key connector. The coverage table has no auth column for
    // it, so it fell through to the `standard-oauth2` family default and the
    // catalog advertised an OAuth flow that does not exist.
    expect(getIntegrationSpec('coda')?.auth.mode).toBe('api_key')
    for (const spec of listIntegrationSpecs()) {
      const manifest = getBundledAdapterManifest(spec.kind)
      if (!manifest) continue
      const mode = bundledAuthMode(manifest)
      if (!mode) continue
      const expected = mode === 'oauth2_client_credentials' ? 'oauth2' : mode
      expect(spec.auth.mode, `${spec.kind} auth mode must match its adapter`).toBe(expected)
    }
  })

  it('only advertises actions the adapter actually implements', () => {
    // The coverage table synthesizes actions from 19 generic packs, so every
    // finance connector advertised `transactions.search`, `accounts.read`,
    // `invoices.create`, `records.sync`. QuickBooks implements one of those
    // four. A named-but-absent tool is worse than an unnamed one — the model
    // spends the turn calling it.
    let audited = 0
    for (const spec of listIntegrationSpecs()) {
      const manifest = getBundledAdapterManifest(spec.kind)
      if (!manifest) continue
      const real = new Set(manifest.capabilities.map((capability) => capability.name))
      for (const action of spec.actions) {
        expect(real.has(action.id), `${spec.kind} advertises "${action.id}", which it cannot execute`).toBe(true)
      }
      audited += 1
    }
    expect(audited).toBeGreaterThan(80)
  })

  it('surfaces the accounting reads a tax return is actually built from', () => {
    const quickbooks = getIntegrationSpec('quickbooks')!.actions.map((action) => action.id)
    expect(quickbooks).toContain('reports.get')
    expect(quickbooks).toContain('entities.query')
    expect(quickbooks).not.toContain('transactions.search')

    const xero = getIntegrationSpec('xero')!.actions.map((action) => action.id)
    // Every other Xero call needs a tenantId, so the discovery capability has
    // to be reachable or the connector is unusable from a cold start.
    expect(xero).toContain('tenants.list')
    expect(xero).toContain('reports.get')
  })

  it('carries the real accounting endpoints QuickBooks and Xero authenticate against', () => {
    const quickbooks = getIntegrationSpec('quickbooks')
    expect(quickbooks?.status).toBe('executable')
    expect((quickbooks?.auth as { authorizationUrl?: string }).authorizationUrl).toBe(
      'https://appcenter.intuit.com/connect/oauth2',
    )
    expect(resolveConnectorAuthSpec('quickbooks')?.requestedScopes).toContain('com.intuit.quickbooks.accounting')

    const xero = getIntegrationSpec('xero')
    expect(xero?.status).toBe('executable')
    expect((xero?.auth as { authorizationUrl?: string }).authorizationUrl).toBe(
      'https://login.xero.com/identity/connect/authorize',
    )
    // Xero cannot address a single call without a tenant, so the grant must
    // request offline access and the tenant-bearing scopes.
    expect(resolveConnectorAuthSpec('xero')?.requestedScopes).toContain('offline_access')
  })

  it('does not misclassify Zoom admin-qualified read scopes as write access', () => {
    const zoom = getIntegrationSpec('zoom')
    expect(zoom?.auth.mode).toBe('oauth2')
    if (zoom?.auth.mode !== 'oauth2') throw new Error('expected Zoom OAuth2')
    const byProviderScope = new Map(zoom.auth.scopes.map((scope) => [scope.providerScope, scope.risk]))
    expect(byProviderScope.get('user:read:user:admin')).toBe('read')
    expect(byProviderScope.get('meeting:read:meeting:admin')).toBe('read')
    expect(byProviderScope.get('cloud_recording:read:recording:admin')).toBe('read')
    expect(byProviderScope.get('meeting:update:meeting:admin')).toBe('write')
    expect(byProviderScope.get('cloud_recording:delete:recording_file:admin')).toBe('write')
  })
})

describe('integration overrides — per-kind setup richness', () => {
  it('stripe-pack carries restricted-key guidance + dashboard URL', () => {
    const spec = getIntegrationSpec('stripe-pack')
    expect(spec).toBeDefined()
    expect(spec!.setup.consoleUrl).toBe('https://dashboard.stripe.com/apikeys')
    expect(spec!.setup.credentialFields).toHaveLength(1)
    const f = spec!.setup.credentialFields[0]
    expect(f.label).toMatch(/Stripe secret key/i)
    expect(f.description).toMatch(/restricted key/i)
    expect(f.regex).toBeDefined()
    // The provided regex matches both live + test secrets/restricted keys.
    expect(validateCredentialFormat(f, 'sk_live_abc123').ok).toBe(true)
    expect(validateCredentialFormat(f, 'rk_live_abc123').ok).toBe(true)
    expect(validateCredentialFormat(f, 'pk_live_abc123').ok).toBe(false) // publishable rejected
  })

  it('twilio-sms exposes a two-field credential set (Account SID + Auth Token)', () => {
    const spec = getIntegrationSpec('twilio-sms')
    expect(spec).toBeDefined()
    const fields = spec!.setup.credentialFields
    expect(fields).toHaveLength(2)
    const sid = fields.find((f) => f.label.includes('Account SID'))
    const token = fields.find((f) => f.label.includes('Auth Token'))
    expect(sid).toBeDefined()
    expect(token).toBeDefined()
    expect(sid!.secret).toBe(false)
    expect(token!.secret).toBe(true)
    // Account SID regex enforces AC-prefixed 32-hex format
    expect(validateCredentialFormat(sid!, 'AC' + 'a'.repeat(32)).ok).toBe(true)
    expect(validateCredentialFormat(sid!, 'XX' + 'a'.repeat(32)).ok).toBe(false)
  })

  it('twilio-sms surfaces the subaccount-tokens quirk via the override layer', () => {
    const spec = getIntegrationSpec('twilio-sms')
    const quirks = spec!.setup.knownQuirks ?? []
    expect(quirks.some((q) => q.id === 'subaccount-tokens')).toBe(true)
  })

  it('phony is an executable api-key connector with a plabs_ key field', () => {
    const spec = getIntegrationSpec('phony')
    expect(spec).toBeDefined()
    expect(spec!.status).toBe('executable')
    expect(spec!.auth.mode).toBe('api_key')
    expect(spec!.setup.credentialFields).toHaveLength(1)
    const key = spec!.setup.credentialFields[0]
    expect(key.secret).toBe(true)
    expect(key.regex).toBe('^plabs_[A-Za-z0-9_-]{32}$')
    // Real key shape: plabs_ + 32 url-safe nanoid chars.
    expect(validateCredentialFormat(key, 'plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm').ok).toBe(true)
    // The earlier-sketched phony_live_ prefix is wrong and must be rejected.
    expect(validateCredentialFormat(key, 'phony_live_' + 'a'.repeat(32)).ok).toBe(false)
    expect(validateCredentialFormat(key, 'plabs_short').ok).toBe(false)
  })

  it('phony surfaces the key-shown-once + rotate quirks via the override layer', () => {
    const spec = getIntegrationSpec('phony')
    const quirks = spec!.setup.knownQuirks ?? []
    expect(quirks.some((q) => q.id === 'key-shown-once')).toBe(true)
    expect(quirks.some((q) => q.id === 'rotate-endpoint')).toBe(true)
  })


  it('a spec with no shipped adapter advertises NO actions', () => {
    // The coverage table synthesizes four actions per action pack, so before
    // this every adapter-less spec named calls that cannot resolve: `jira`
    // claimed tasks.search/read/create/update, `microsoft-excel` claimed
    // records.query/read/upsert/delete, and netsuite/sage/plaid claimed the
    // finance four. A model told about a tool that does not exist spends the
    // turn on it, and the failure reads as the agent being broken.
    const withoutAdapter = listIntegrationSpecs().filter((spec) => !hasBundledAdapter(spec.kind))
    expect(withoutAdapter.length).toBeGreaterThan(0)
    const advertising = withoutAdapter.filter((spec) => spec.actions.length > 0)
    expect(
      advertising.map((spec) => spec.kind),
      'adapter-less specs must not name actions',
    ).toEqual([])
  })

  it('a spec WITH an adapter advertises exactly that adapter\'s capabilities', () => {
    for (const spec of listIntegrationSpecs()) {
      const manifest = getBundledAdapterManifest(spec.kind)
      if (!manifest) continue
      expect(
        spec.actions.map((action) => action.id).sort(),
        `${spec.kind} drifted from its adapter`,
      ).toEqual(manifest.capabilities.map((capability) => capability.name).sort())
    }
  })

  it('emptying the action list does not downgrade permissions or data class', () => {
    // permissions/plannerHints describe the DATA a connector reaches, not its
    // callable entry points, so they stay derived from the coverage pack.
    // Deriving them from the now-empty action list instead would silently drop
    // every write permission and mark all of these `public` — trading a prompt
    // defect for a consent defect.
    const withoutAdapter = listIntegrationSpecs().filter((spec) => !hasBundledAdapter(spec.kind))
    const noWrite = withoutAdapter.filter((spec) => !spec.permissions.some((p) => p.risk === 'write'))
    expect(noWrite.map((s) => s.kind), 'lost their write permission').toEqual([])
    const publicClass = withoutAdapter.filter((spec) => spec.permissions[0]?.dataClass === 'public')
    expect(publicClass.map((s) => s.kind), 'downgraded to dataClass public').toEqual([])
  })

  it('kinds without overrides fall through to family defaults', () => {
    // gmail has no override; should use the google family's default fields
    // (Client ID + Client Secret) and the Google Cloud Console URL.
    const spec = getIntegrationSpec('gmail')
    expect(spec!.setup.consoleUrl).toBe('https://console.cloud.google.com/apis/credentials')
    expect(spec!.setup.credentialFields).toHaveLength(2)
    expect(spec!.setup.credentialFields[0].label).toMatch(/client id/i)
  })
})
