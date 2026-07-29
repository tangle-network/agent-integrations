import {
  buildIntegrationCoverageConnectors,
  listIntegrationCoverageSpecs,
  type IntegrationCoverageSpec,
} from '../coverage-catalog.js'
import type {
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
} from '../index.js'
import {
  bundledApiKeyHint,
  bundledAuthMode,
  bundledOAuth2Auth,
  getBundledAdapterManifest,
} from '../connectors/bundled-manifests.js'
import type { ConnectorManifest } from '../connectors/types.js'
import { INTEGRATION_FAMILIES, getIntegrationFamily } from './families.js'
import { getIntegrationOverride } from './overrides.js'
import type {
  ApiKeyAuthSpec,
  CustomAuthSpec,
  HealthcheckSpec,
  HmacAuthSpec,
  IntegrationAuthSpec,
  IntegrationFamilyId,
  IntegrationPlannerHints,
  IntegrationSpec,
  IntegrationSpecStatus,
  NoneAuthSpec,
  NormalizedPermission,
  OAuth2AuthSpec,
  PermissionDescriptor,
  ScopeDescriptor,
} from './types.js'

/**
 * Executability and OAuth endpoints are DERIVED from the bundled adapter
 * registry, never restated here.
 *
 * This used to be a hand-maintained `EXECUTABLE_KINDS` set of 18 names. The
 * package ships 530 adapters, so the set was wrong by two orders of magnitude
 * and every new adapter silently landed as `status: 'catalog'`. Worse, the
 * oauth2 branch of `authFor` fabricated `https://example.invalid/<kind>/...`
 * whenever the family table had no endpoint — 104 of 131 oauth2 entries — so
 * a Connect button could be wired to a reserved TLD that can never resolve.
 * A catalog that describes connectors must read the connectors.
 */
function bundledManifestFor(kind: string, coverageId: string) {
  return getBundledAdapterManifest(kind) ?? getBundledAdapterManifest(coverageId)
}

const KIND_ALIASES: Record<string, string> = {
  'outlook-calendar': 'microsoft-calendar',
  'notion-database': 'notion',
  stripe: 'stripe-pack',
  twilio: 'twilio-sms',
}

export function listIntegrationSpecs(): IntegrationSpec[] {
  const connectors = new Map(buildIntegrationCoverageConnectors({ providerId: 'spec' }).map((c) => [c.id, c]))
  return listIntegrationCoverageSpecs().map((coverage) => {
    const connector = connectors.get(coverage.id)
    if (!connector) throw new Error(`missing coverage connector for ${coverage.id}`)
    return specFromCoverage(coverage, connector)
  })
}

export function getIntegrationSpec(kind: string): IntegrationSpec | undefined {
  const canonical = KIND_ALIASES[kind] ?? kind
  return listIntegrationSpecs().find((spec) => spec.kind === canonical || KIND_ALIASES[spec.kind] === canonical)
}

/** Auth-driving descriptor the hub uses to start a connect flow per provider
 *  instead of hard-coding scopes/auth kind. Derived from the spec catalog
 *  ({@link getIntegrationSpec}); undefined when the kind is not in the
 *  catalog. */
export interface ConnectorAuthSpec {
  kind: string
  authKind: 'oauth2' | 'api_key' | 'none' | 'custom'
  /** Provider scopes to request in the authorization grant. Empty for
   *  api_key / none / custom. */
  requestedScopes: string[]
  /** OAuth-only: authorization + token endpoints and PKCE posture. Present
   *  only when authKind === 'oauth2'. */
  authorizationUrl?: string
  tokenUrl?: string
  pkce?: 'required' | 'supported' | 'unsupported'
  redirectUriTemplate?: string
  clientIdEnv?: string
  clientSecretEnv?: string
  extraAuthParams?: Record<string, string>
}

export function resolveConnectorAuthSpec(kind: string): ConnectorAuthSpec | undefined {
  const spec = getIntegrationSpec(kind)
  if (!spec) return undefined
  const auth = spec.auth
  if (auth.mode === 'oauth2') {
    return {
      kind: spec.kind,
      authKind: 'oauth2',
      requestedScopes: auth.scopes.map((scope) => scope.providerScope).filter(Boolean),
      authorizationUrl: auth.authorizationUrl,
      tokenUrl: auth.tokenUrl,
      pkce: auth.pkce,
      redirectUriTemplate: auth.redirectUriTemplate,
      clientIdEnv: auth.clientIdEnv,
      clientSecretEnv: auth.clientSecretEnv,
      extraAuthParams: auth.extraAuthParams,
    }
  }
  if (auth.mode === 'api_key') {
    return { kind: spec.kind, authKind: 'api_key', requestedScopes: [] }
  }
  if (auth.mode === 'none') {
    return { kind: spec.kind, authKind: 'none', requestedScopes: [] }
  }
  return { kind: spec.kind, authKind: 'custom', requestedScopes: [] }
}

export function listExecutableIntegrationSpecs(): IntegrationSpec[] {
  return listIntegrationSpecs().filter((spec) => spec.status === 'executable')
}

export function integrationSpecToConnector(spec: IntegrationSpec, providerId = 'spec'): IntegrationConnector {
  return {
    id: spec.kind,
    providerId,
    title: spec.title,
    category: spec.category,
    auth: spec.auth.mode === 'api_key' ? 'api_key' : spec.auth.mode === 'oauth2' ? 'oauth2' : spec.auth.mode === 'none' ? 'none' : 'custom',
    scopes: spec.permissions.flatMap((permission) => permission.providerScopes),
    actions: spec.actions,
    triggers: spec.triggers,
    metadata: {
      ...(spec.metadata ?? {}),
      source: 'integration-spec',
      status: spec.status,
      family: spec.family,
      plannerHints: spec.plannerHints,
    },
  }
}

function specFromCoverage(coverage: IntegrationCoverageSpec, connector: IntegrationConnector): IntegrationSpec {
  const kind = KIND_ALIASES[coverage.id] ?? coverage.id
  const family = familyFor(coverage)
  const familySpec = getIntegrationFamily(family)
  const manifest = bundledManifestFor(kind, coverage.id)
  // A spec with no shipped adapter has no real action ids to give. The
  // coverage table would supply four synthesized from its action pack, and
  // naming those is the failure this whole module exists to end: 33 of 143
  // specs have no adapter, and every one of them advertised invented calls
  // (`jira` claimed `tasks.search`/`tasks.read`/`tasks.create`/`tasks.update`,
  // `microsoft-excel` claimed `records.query`...). A model told about a tool
  // that cannot resolve spends the turn on it, and the failure reads as the
  // agent being broken. Listing the connector with NO actions is honest and
  // still discoverable — it is genuinely connectable, it just cannot run
  // anything yet.
  //
  // The synthesized set is still what `permissions` and `plannerHints` are
  // derived from, because those describe the DATA the connector reaches
  // (read/write shape, data class, provider scopes) rather than callable
  // entry points. Deriving them from an empty list instead would silently
  // drop the write permission and downgrade every one of the 33 to
  // `dataClass: 'public'` — trading a prompt defect for a consent defect.
  const derivationActions = manifest
    ? actionsFromManifest(manifest, dataClassFor(connector.actions))
    : connector.actions
  const actions = manifest ? derivationActions : []
  const permissions = permissionsFor(coverage, derivationActions)
  const auth = authFor(coverage, family, permissions, kind)
  const status = statusFor(kind, coverage.id)
  // Per-kind overrides layer in here — see specs/overrides.ts. The override
  // is consulted under the canonical kind AND the original coverage id so
  // alias-collapsed kinds (e.g. notion-database → notion) can carry an
  // override under either name.
  const override =
    getIntegrationOverride(kind) ?? getIntegrationOverride(coverage.id)
  // Family quirks + override quirks are concatenated; everything else is
  // a replace (override fields take precedence when present).
  const knownQuirks = override?.knownQuirks
    ? [...(familySpec.knownQuirks ?? []), ...override.knownQuirks]
    : familySpec.knownQuirks
  return {
    kind,
    title: connector.title,
    category: connector.category,
    status,
    family,
    auth,
    permissions,
    actions,
    triggers: connector.triggers,
    setup: {
      consoleUrl: override?.consoleUrl ?? familySpec.consoleUrl,
      consoleSteps: override?.consoleSteps ?? familySpec.consoleSteps,
      credentialFields: override?.credentialFields ?? credentialFieldsFor(auth),
      redirectUriTemplate: auth.mode === 'oauth2' ? auth.redirectUriTemplate : familySpec.redirectUriTemplate,
      knownQuirks,
      postSetup: override?.postSetup,
      healthcheck: override?.healthcheck ?? healthcheckFor(kind, status, auth),
    },
    lifecycle: familySpec.lifecycle,
    plannerHints: plannerHintsFor(coverage, derivationActions),
    metadata: { priority: coverage.priority, domains: coverage.domains },
  }
}

function familyFor(spec: IntegrationCoverageSpec): IntegrationFamilyId {
  if (hmacKinds.has(spec.id)) return 'hmac'
  if (spec.auth === 'none') return 'none'
  if (spec.id.startsWith('google-') || spec.domains.includes('google')) return 'google'
  if (spec.id.startsWith('microsoft-') || ['outlook-mail', 'outlook-calendar', 'onedrive', 'sharepoint'].includes(spec.id)) return 'microsoft-graph'
  if (['jira', 'confluence', 'trello', 'bitbucket'].includes(spec.id)) return 'atlassian'
  if (spec.id === 'salesforce') return 'salesforce'
  if (spec.id === 'hubspot') return 'hubspot'
  if (spec.id === 'slack') return 'slack'
  if (spec.id === 'notion') return 'notion'
  if (apiKeyKinds.has(spec.id)) return 'api-key'
  return 'standard-oauth2'
}

const apiKeyKinds = new Set(['github', 'gitlab', 'airtable', 'asana', 'stripe', 'twilio', 'sendgrid', 'postmark', 'phony'])
const hmacKinds = new Set(['webhook'])

function authFor(
  spec: IntegrationCoverageSpec,
  family: IntegrationFamilyId,
  permissions: PermissionDescriptor[],
  kind: string,
): IntegrationAuthSpec {
  const f = INTEGRATION_FAMILIES[family]
  // The shipped adapter decides HOW a connector authenticates. The coverage
  // table only guesses: it defaults every unlisted entry to the
  // `standard-oauth2` family, which is how Coda — an api-key connector —
  // came to advertise an OAuth flow it does not have.
  const manifest = bundledManifestFor(kind, spec.id)
  const realMode = manifest ? bundledAuthMode(manifest) : undefined
  if (spec.auth === 'custom' && !manifest) {
    return {
      mode: 'custom',
      description: `${spec.title} requires a provider-approved commercial API agreement and workspace-specific credentials.`,
    } satisfies CustomAuthSpec
  }
  if (realMode === 'none') return { mode: 'none' } satisfies NoneAuthSpec
  if (realMode === 'hmac') {
    return {
      mode: 'hmac',
      credential: INTEGRATION_FAMILIES.hmac.credentialFields[0]!,
      signatureHeader: `${spec.id}-signature`,
    } satisfies HmacAuthSpec
  }
  if (realMode === 'api_key') {
    const hint = manifest ? bundledApiKeyHint(manifest) : undefined
    const credential = apiKeyFieldFor(spec.id)
    return {
      mode: 'api_key',
      credential: hint ? { ...credential, description: hint } : credential,
      placement: apiKeyPlacementFor(spec.id),
    } satisfies ApiKeyAuthSpec
  }
  if (family === 'none' && !realMode) return { mode: 'none' } satisfies NoneAuthSpec
  if (family === 'hmac' && !realMode) {
    return { mode: 'hmac', credential: f.credentialFields[0]!, signatureHeader: `${spec.id}-signature` } satisfies HmacAuthSpec
  }
  if (family === 'api-key' && !realMode) {
    return { mode: 'api_key', credential: apiKeyFieldFor(spec.id), placement: apiKeyPlacementFor(spec.id) } satisfies ApiKeyAuthSpec
  }
  const scopes = permissions.flatMap((permission) =>
    permission.providerScopes.map((providerScope): ScopeDescriptor => ({
      normalized: permission.normalized,
      providerScope,
      title: permission.title,
      reason: permission.reason,
      risk: permission.risk,
      dataClass: permission.dataClass,
    })),
  )
  // A shipped adapter is the authority on how its provider authenticates:
  // it holds the endpoints the connect flow actually posts to and the exact
  // scope set the grant must request. Prefer it over the family defaults,
  // and never substitute a placeholder when neither knows — an absent URL is
  // a fact the caller can check, whereas `https://example.invalid/...` is a
  // dead link that reads as configuration.
  const real = manifest ? bundledOAuth2Auth(manifest) : undefined
  return {
    mode: 'oauth2',
    authorizationUrl: real?.authorizationUrl ?? f.authorizationUrl,
    tokenUrl: real?.tokenUrl ?? f.tokenUrl,
    clientIdEnv: real?.clientIdEnv ?? f.credentialFields.find((field) => !field.secret)?.env,
    clientSecretEnv: real?.clientSecretEnv ?? f.credentialFields.find((field) => field.secret)?.env,
    scopes: real ? scopesFromManifest(real.scopes, permissions) : scopes,
    extraAuthParams: real?.extraAuthParams ?? extraAuthParamsFor(family),
    redirectUriTemplate: (f.redirectUriTemplate ?? 'https://{host}/api/integrations/oauth/{kind}/callback').replace('{kind}', spec.id),
    pkce: family === 'google' || family === 'microsoft-graph' ? 'supported' : 'unsupported',
  } satisfies OAuth2AuthSpec
}

/**
 * The action list an agent is shown, taken from the adapter's own capability
 * catalog.
 *
 * The coverage table synthesizes actions from 19 generic "action packs", so
 * every finance-pack connector advertised the same four names —
 * `transactions.search`, `accounts.read`, `invoices.create`, `records.sync`.
 * For QuickBooks and Xero, one of those four exists. The other three are tool
 * calls that can only fail, while the capabilities that DO exist (`reports.get`,
 * `entities.query`, `tenants.list`) went unmentioned. Naming a tool that does
 * not exist is worse than naming none: the model spends the turn on it.
 */
function actionsFromManifest(
  manifest: ConnectorManifest,
  fallbackDataClass: IntegrationDataClass,
): IntegrationConnectorAction[] {
  return manifest.capabilities.map((capability): IntegrationConnectorAction => {
    const mutation = capability.class === 'mutation'
    return {
      id: capability.name,
      title: capability.name,
      risk: mutation ? 'write' : 'read',
      requiredScopes: capability.requiredScopes ? [...capability.requiredScopes] : [],
      dataClass: fallbackDataClass,
      description: capability.description,
      // A mutation reaching resources outside the caller needs confirmation
      // before it runs; the adapter is what knows which those are.
      approvalRequired: mutation ? capability.externalEffect : undefined,
      inputSchema: capability.parameters,
    }
  })
}

/** Pair the adapter's REAL provider scopes with the closest permission
 *  descriptor for UI copy. The scope SET is taken verbatim from the manifest
 *  because it is what the authorization grant actually requests — only the
 *  surrounding title/risk labelling is matched heuristically, by whether the
 *  scope names a mutating capability. */
function scopesFromManifest(
  providerScopes: string[],
  permissions: PermissionDescriptor[],
): ScopeDescriptor[] {
  const writePermission = permissions.find((permission) => permission.risk === 'write')
  const readPermission = permissions.find((permission) => permission.risk === 'read') ?? permissions[0]
  return providerScopes.map((providerScope): ScopeDescriptor => {
    const mutating = /(?:^|[.\/_:-])(?:write|manage|create|modify|edit|update|delete|full|admin|readwrite)(?:$|[.\/_:-])/i.test(
      providerScope,
    )
    const base = (mutating ? writePermission : readPermission) ?? readPermission
    return {
      normalized: base?.normalized ?? 'unknown.read',
      providerScope,
      title: base?.title ?? providerScope,
      reason: base?.reason ?? 'Requested by the connector.',
      risk: mutating ? 'write' : 'read',
      dataClass: base?.dataClass ?? 'private',
    }
  })
}

function credentialFieldsFor(auth: IntegrationAuthSpec) {
  if (auth.mode === 'api_key' || auth.mode === 'hmac') return [auth.credential]
  if (auth.mode === 'oauth2') {
    return [
      { label: 'Client ID', env: auth.clientIdEnv, description: 'OAuth client ID.', secret: false },
      { label: 'Client Secret', env: auth.clientSecretEnv, description: 'OAuth client secret.', secret: true },
    ]
  }
  return []
}

function permissionsFor(spec: IntegrationCoverageSpec, actions: IntegrationConnectorAction[]): PermissionDescriptor[] {
  const dataClass = dataClassFor(actions)
  const readScope = providerScopeFor(spec, 'read')
  const writeScope = providerScopeFor(spec, 'write')
  const permissions: PermissionDescriptor[] = [
    {
      normalized: `${spec.actionPack}.read` as NormalizedPermission,
      providerScopes: readScope ? [readScope] : [],
      title: `${spec.title} read`,
      risk: 'read',
      dataClass,
      reason: `Read ${spec.title} data for user-authorized agent workflows.`,
    },
  ]
  if (actions.some((a) => a.risk !== 'read')) {
    permissions.push({
      normalized: `${spec.actionPack}.write` as NormalizedPermission,
      providerScopes: writeScope ? [writeScope] : [],
      title: `${spec.title} write`,
      risk: 'write',
      dataClass,
      reason: `Create or update ${spec.title} resources after policy approval.`,
    })
  }
  return permissions
}

function providerScopeFor(spec: IntegrationCoverageSpec, mode: 'read' | 'write'): string {
  const explicit = explicitScopes[spec.id]?.[mode]
  if (explicit) return explicit
  if (spec.auth === 'none') return ''
  return `${spec.id}.${mode}`
}

const explicitScopes: Record<string, Partial<Record<'read' | 'write', string>>> = {
  gmail: { read: 'https://www.googleapis.com/auth/gmail.readonly', write: 'https://www.googleapis.com/auth/gmail.modify' },
  'google-calendar': { read: 'https://www.googleapis.com/auth/calendar.readonly', write: 'https://www.googleapis.com/auth/calendar' },
  'google-sheets': { read: 'https://www.googleapis.com/auth/spreadsheets.readonly', write: 'https://www.googleapis.com/auth/spreadsheets' },
  'google-drive': { read: 'https://www.googleapis.com/auth/drive.readonly', write: 'https://www.googleapis.com/auth/drive.file' },
  'google-docs': { read: 'https://www.googleapis.com/auth/documents.readonly', write: 'https://www.googleapis.com/auth/documents' },
  'outlook-mail': { read: 'Mail.Read', write: 'Mail.Send' },
  'outlook-calendar': { read: 'Calendars.Read', write: 'Calendars.ReadWrite' },
  'microsoft-teams': { read: 'ChannelMessage.Read.All', write: 'ChannelMessage.Send' },
  onedrive: { read: 'Files.Read', write: 'Files.ReadWrite' },
  sharepoint: { read: 'Sites.Read.All', write: 'Sites.ReadWrite.All' },
  slack: { read: 'channels:read', write: 'chat:write' },
  hubspot: { read: 'crm.objects.contacts.read', write: 'crm.objects.contacts.write' },
  salesforce: { read: 'api', write: 'api' },
  notion: { read: '', write: '' },
  github: { read: 'repo:read', write: 'repo' },
  gitlab: { read: 'read_api', write: 'api' },
  airtable: { read: 'data.records:read', write: 'data.records:write' },
  asana: { read: 'default', write: 'default' },
  stripe: { read: 'read_only', write: 'standard' },
  twilio: { read: 'api_key', write: 'api_key' },
}

function plannerHintsFor(spec: IntegrationCoverageSpec, actions: IntegrationConnectorAction[]): IntegrationPlannerHints {
  return {
    useFor: spec.domains.map((domain) => domain.replace(/-/g, ' ')),
    dataFreshness: ['calendar', 'chat', 'commerce', 'finance', 'support'].includes(spec.actionPack) ? 'near_realtime' : 'eventual',
    writeRisk: actions.some((a) => a.risk === 'destructive') ? 'high' : actions.some((a) => a.risk === 'write') ? 'medium' : 'low',
  }
}

function healthcheckFor(kind: string, status: IntegrationSpecStatus, auth: IntegrationAuthSpec): HealthcheckSpec {
  if (status !== 'executable') {
    return { id: `${kind}.static`, level: 'static', description: 'Catalog-only integration; no executable connector healthcheck is available yet.' }
  }
  if (auth.mode === 'oauth2') {
    return { id: `${kind}.connection`, level: 'connection', description: 'Validate a user connection by calling the connector test endpoint.' }
  }
  if (auth.mode === 'api_key') {
    return { id: `${kind}.connection`, level: 'connection', description: 'Validate API credentials by calling the connector test endpoint.' }
  }
  if (auth.mode === 'hmac') {
    return { id: `${kind}.webhook`, level: 'webhook', description: 'Validate webhook signing configuration with a signed test payload.' }
  }
  return { id: `${kind}.static`, level: 'static', description: 'No credentials are required.' }
}

function statusFor(kind: string, coverageId: string): IntegrationSpecStatus {
  return bundledManifestFor(kind, coverageId) ? 'executable' : 'catalog'
}

function dataClassFor(actions: IntegrationConnectorAction[]): IntegrationDataClass {
  if (actions.some((a) => a.dataClass === 'secret')) return 'secret'
  if (actions.some((a) => a.dataClass === 'sensitive')) return 'sensitive'
  if (actions.some((a) => a.dataClass === 'private')) return 'private'
  if (actions.some((a) => a.dataClass === 'internal')) return 'internal'
  return 'public'
}

function apiKeyFieldFor(kind: string) {
  return {
    label: `${kind} API key`,
    description: `API key or token for ${kind}.`,
    example: kind === 'stripe' ? 'sk_live_...' : undefined,
    secret: true,
  }
}

function apiKeyPlacementFor(kind: string): ApiKeyAuthSpec['placement'] {
  if (kind === 'gitlab') return 'header'
  return 'bearer'
}

function extraAuthParamsFor(family: IntegrationFamilyId): Record<string, string> | undefined {
  if (family === 'google') return { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }
  if (family === 'notion') return { owner: 'user' }
  return undefined
}
