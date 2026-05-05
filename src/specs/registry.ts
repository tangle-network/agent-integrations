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
import { INTEGRATION_FAMILIES, getIntegrationFamily } from './families.js'
import type {
  ApiKeyAuthSpec,
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

const EXECUTABLE_KINDS = new Set([
  'google-calendar',
  'google-sheets',
  'outlook-calendar',
  'microsoft-calendar',
  'slack',
  'hubspot',
  'notion',
  'notion-database',
  'salesforce',
  'github',
  'gitlab',
  'airtable',
  'asana',
  'stripe',
  'stripe-pack',
  'twilio',
  'twilio-sms',
  'webhook',
])

const KIND_ALIASES: Record<string, string> = {
  'outlook-calendar': 'microsoft-calendar',
  notion: 'notion-database',
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
  const permissions = permissionsFor(coverage, connector.actions)
  const auth = authFor(coverage, family, permissions)
  const status = statusFor(kind)
  return {
    kind,
    title: connector.title,
    category: connector.category,
    status,
    family,
    auth,
    permissions,
    actions: connector.actions,
    triggers: connector.triggers,
    setup: {
      consoleUrl: familySpec.consoleUrl,
      consoleSteps: familySpec.consoleSteps,
      credentialFields: credentialFieldsFor(auth),
      redirectUriTemplate: auth.mode === 'oauth2' ? auth.redirectUriTemplate : familySpec.redirectUriTemplate,
      knownQuirks: familySpec.knownQuirks,
      healthcheck: healthcheckFor(kind, status, auth),
    },
    lifecycle: familySpec.lifecycle,
    plannerHints: plannerHintsFor(coverage, connector.actions),
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

const apiKeyKinds = new Set(['github', 'gitlab', 'airtable', 'asana', 'stripe', 'twilio', 'sendgrid', 'postmark'])
const hmacKinds = new Set(['webhook'])

function authFor(
  spec: IntegrationCoverageSpec,
  family: IntegrationFamilyId,
  permissions: PermissionDescriptor[],
): IntegrationAuthSpec {
  const f = INTEGRATION_FAMILIES[family]
  if (family === 'none') return { mode: 'none' } satisfies NoneAuthSpec
  if (family === 'hmac') {
    return { mode: 'hmac', credential: f.credentialFields[0]!, signatureHeader: `${spec.id}-signature` } satisfies HmacAuthSpec
  }
  if (family === 'api-key') {
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
  return {
    mode: 'oauth2',
    authorizationUrl: f.authorizationUrl ?? `https://example.invalid/${spec.id}/authorize`,
    tokenUrl: f.tokenUrl ?? `https://example.invalid/${spec.id}/token`,
    clientIdEnv: f.credentialFields.find((field) => !field.secret)?.env,
    clientSecretEnv: f.credentialFields.find((field) => field.secret)?.env,
    scopes,
    extraAuthParams: extraAuthParamsFor(family),
    redirectUriTemplate: (f.redirectUriTemplate ?? 'https://{host}/api/integrations/oauth/{kind}/callback').replace('{kind}', spec.id),
    pkce: family === 'google' || family === 'microsoft-graph' ? 'supported' : 'unsupported',
  } satisfies OAuth2AuthSpec
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

function statusFor(kind: string): IntegrationSpecStatus {
  return EXECUTABLE_KINDS.has(kind) ? 'executable' : 'catalog'
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
