import type {
  IntegrationActionRisk,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationConnectorCategory,
  IntegrationConnectorTrigger,
  IntegrationDataClass,
} from '../index.js'

export type IntegrationAuthMode = 'oauth2' | 'api_key' | 'hmac' | 'none' | 'custom'

export type IntegrationSpecStatus = 'catalog' | 'executable' | 'deprecated'

export type IntegrationFamilyId =
  | 'google'
  | 'microsoft-graph'
  | 'atlassian'
  | 'salesforce'
  | 'hubspot'
  | 'slack'
  | 'notion'
  | 'standard-oauth2'
  | 'api-key'
  | 'hmac'
  | 'none'

export type NormalizedPermission =
  | `${string}.read`
  | `${string}.write`
  | `${string}.delete`
  | `${string}.admin`

export interface IntegrationSpec {
  kind: string
  title: string
  category: IntegrationConnectorCategory
  status: IntegrationSpecStatus
  family: IntegrationFamilyId
  auth: IntegrationAuthSpec
  permissions: PermissionDescriptor[]
  actions: IntegrationConnectorAction[]
  triggers?: IntegrationConnectorTrigger[]
  setup: IntegrationSetupSpec
  lifecycle?: IntegrationLifecycleSpec
  plannerHints?: IntegrationPlannerHints
  metadata?: Record<string, unknown>
}

export type IntegrationAuthSpec =
  | OAuth2AuthSpec
  | ApiKeyAuthSpec
  | HmacAuthSpec
  | NoneAuthSpec
  | CustomAuthSpec

export interface OAuth2AuthSpec {
  mode: 'oauth2'
  authorizationUrl: string
  tokenUrl: string
  clientIdEnv?: string
  clientSecretEnv?: string
  scopes: ScopeDescriptor[]
  extraAuthParams?: Record<string, string>
  redirectUriTemplate: string
  pkce?: 'required' | 'supported' | 'unsupported'
}

export interface ApiKeyAuthSpec {
  mode: 'api_key'
  credential: CredentialFieldSpec
  placement?: 'bearer' | 'header' | 'query' | 'basic'
}

export interface HmacAuthSpec {
  mode: 'hmac'
  credential: CredentialFieldSpec
  signatureHeader?: string
}

export interface NoneAuthSpec {
  mode: 'none'
}

export interface CustomAuthSpec {
  mode: 'custom'
  description: string
}

export interface ScopeDescriptor {
  normalized: NormalizedPermission
  providerScope: string
  title: string
  reason: string
  risk: IntegrationActionRisk
  dataClass: IntegrationDataClass
}

export interface PermissionDescriptor {
  normalized: NormalizedPermission
  providerScopes: string[]
  title: string
  risk: IntegrationActionRisk
  dataClass: IntegrationDataClass
  reason: string
}

export interface CredentialFieldSpec {
  label: string
  description: string
  env?: string
  example?: string
  regex?: string
  secret: boolean
}

export interface ConsoleStep {
  id: string
  title: string
  detail: string
  copyValue?: string
}

export interface Quirk {
  id: string
  severity: 'info' | 'warning' | 'critical'
  message: string
}

export interface PostSetupCheck {
  id: string
  title: string
  detail: string
}

export interface HealthcheckSpec {
  id: string
  level: 'client_config' | 'connection' | 'webhook' | 'static'
  method?: 'GET' | 'POST'
  url?: string
  expectedStatus?: number[]
  description: string
}

export interface IntegrationSetupSpec {
  consoleUrl?: string
  consoleSteps: ConsoleStep[]
  credentialFields: CredentialFieldSpec[]
  redirectUriTemplate?: string
  knownQuirks?: Quirk[]
  postSetup?: PostSetupCheck[]
  healthcheck?: HealthcheckSpec
}

export interface IntegrationLifecycleSpec {
  supportsRefresh: boolean
  supportsRevoke: boolean
  supportsIncrementalAuth: boolean
  recommendedHealthcheckIntervalHours?: number
  freshnessSloMinutes?: number
}

export interface IntegrationPlannerHints {
  useFor: string[]
  avoidFor?: string[]
  dataFreshness: 'realtime' | 'near_realtime' | 'eventual' | 'manual'
  writeRisk: 'low' | 'medium' | 'high'
}

export interface IntegrationFamilySpec {
  id: IntegrationFamilyId
  title: string
  authMode: IntegrationAuthMode
  consoleUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  redirectUriTemplate?: string
  credentialFields: CredentialFieldSpec[]
  consoleSteps: ConsoleStep[]
  knownQuirks?: Quirk[]
  lifecycle: IntegrationLifecycleSpec
}

export interface IntegrationSpecValidationIssue {
  path: string
  message: string
}

export interface IntegrationSpecValidationResult {
  ok: boolean
  issues: IntegrationSpecValidationIssue[]
}

export interface RenderSpecOptions {
  host: string
  callbackPath?: string
}

export interface RenderedConsoleStep extends ConsoleStep {
  detail: string
  copyValue?: string
}

export interface CredentialValidationInput {
  field: CredentialFieldSpec
  value: string
}

export interface CredentialValidationResult {
  ok: boolean
  field: string
  message?: string
}

export interface HealthcheckPlan {
  kind: string
  healthcheck: HealthcheckSpec
  requires: Array<'client_id' | 'client_secret' | 'api_key' | 'hmac_secret' | 'connection_credentials'>
  message: string
}

export function specAuthToConnectorAuth(auth: IntegrationAuthSpec): IntegrationConnector['auth'] {
  if (auth.mode === 'api_key') return 'api_key'
  if (auth.mode === 'oauth2') return 'oauth2'
  if (auth.mode === 'none') return 'none'
  return 'custom'
}
