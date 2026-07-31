/**
 * Per-kind overrides on top of family defaults.
 *
 * The family layer (`families.ts`) carries the auth-shape defaults — generic
 * "API Key" or "Client ID + Client Secret" credential fields, generic console
 * steps. Most kinds are happy with that. But some have provider-specific
 * shape that the family can't capture: Twilio's auth is two-part (Account
 * SID + Auth Token); Stripe's preferred path is restricted keys with specific
 * granted permissions; SendGrid demands a verified sender domain in the
 * console before keys work.
 *
 * `INTEGRATION_OVERRIDES` is the seam for that. The registry merges the
 * override on top of the family defaults at spec-build time. Override
 * fields are purely additive — set what you want to customize, leave the
 * rest absent and the family defaults apply.
 *
 * Adding a new override:
 *   1. Author the override entry below.
 *   2. The next spec build picks it up automatically; no other registry
 *      change needed. Coverage catalog stays compact.
 *
 * Why a separate map and not inline on `IntegrationCoverageSpec`: the
 * coverage catalog is a flat tuple list optimized for fast iteration over
 * 142 specs. Bloating the tuple with optional override fields hurts
 * readability of the catalog AND scatters provider knowledge across two
 * data shapes. Keeping overrides in their own keyed map means contributors
 * looking for "how does Stripe credential setup work" find it in one place.
 */

import type {
  ConsoleStep,
  CredentialFieldSpec,
  HealthcheckSpec,
  PostSetupCheck,
  Quirk,
} from './types.js'

export interface IntegrationOverride {
  /** Replaces `setup.consoleUrl` from the family default. */
  consoleUrl?: string
  /** Replaces `setup.consoleSteps`. Specify the full list — overrides do
   *  not deep-merge step arrays because step ordering is meaningful. */
  consoleSteps?: ConsoleStep[]
  /** Replaces `setup.credentialFields`. Use to add a second field (e.g.
   *  Twilio Account SID + Auth Token), tighten validation regex, or
   *  enrich field descriptions with provider-specific guidance. */
  credentialFields?: CredentialFieldSpec[]
  /** Appended to `setup.knownQuirks`. */
  knownQuirks?: Quirk[]
  /** Replaces `setup.postSetup`. */
  postSetup?: PostSetupCheck[]
  /** Replaces the healthcheck the registry would otherwise infer. */
  healthcheck?: HealthcheckSpec
}

export const INTEGRATION_OVERRIDES: Record<string, IntegrationOverride> = {
  discourse: {
    consoleUrl: 'https://meta.discourse.org/t/create-and-configure-an-api-key/230124',
    credentialFields: [
      {
        label: 'Discourse API credential bundle',
        description: 'JSON containing apiKey and apiUsername. Store the public HTTPS forum root as connection metadata baseUrl.',
        example: '{"apiKey":"...","apiUsername":"system"}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'key', title: 'Create a scoped API key', detail: 'In Admin > API > Keys, create a dedicated key with the smallest required scope and user level.' },
      { id: 'username', title: 'Choose the acting user', detail: 'Use a dedicated service user whenever site-wide administrator authority is not required.' },
      { id: 'host', title: 'Record the forum URL', detail: 'Store the public HTTPS forum root as connection metadata baseUrl.' },
      { id: 'store', title: 'Store the credential bundle', detail: 'Save apiKey and apiUsername in the encrypted connection credential bundle.' },
    ],
    knownQuirks: [
      { id: 'acting-user', severity: 'warning', message: 'Every action is attributed to Api-Username and limited by both that user and the key scopes. Use separate keys for automation with different authority.' },
      { id: 'admin-actions', severity: 'warning', message: 'Category creation and moderation require staff or administrator authority and should remain approval-gated.' },
    ],
  },
  baserow: {
    consoleUrl: 'https://baserow.io/dashboard/settings/database-tokens',
    credentialFields: [
      {
        label: 'Baserow database token',
        description: 'Create a dedicated database token and grant only the required tables and create/read/update/delete permissions.',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'token', title: 'Create a database token', detail: 'Open workspace settings, create a dedicated token, and name it Tangle Integration Hub.' },
      { id: 'permissions', title: 'Limit table permissions', detail: 'Grant only the tables and create, read, update, or delete operations required by approved workflows.' },
      { id: 'store', title: 'Store the token', detail: 'Paste the token once. Tangle Hub seals it before persistence.' },
    ],
    knownQuirks: [
      { id: 'token-scope', severity: 'info', message: 'Database tokens intentionally cannot create tables or manage webhooks. Those account-level operations require a short-lived user JWT and are not advertised by this connector.' },
      { id: 'self-hosted-url', severity: 'info', message: 'For self-hosted Baserow, store the public HTTPS API root in connection metadata as baseUrl.' },
    ],
  },
  'ping-identity': {
    consoleUrl: 'https://console.pingone.com/',
    credentialFields: [
      {
        label: 'PingOne worker credential bundle',
        description: 'JSON containing clientId, clientSecret, and region (us, ca, eu, au, or asia). Store the PingOne environment id as connection metadata.',
        example: '{"clientId":"...","clientSecret":"...","region":"us"}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'worker-app', title: 'Create a worker application', detail: 'Create a dedicated PingOne worker application with the minimum user and group administration roles.' },
      { id: 'environment', title: 'Record environment and region', detail: 'Copy the PingOne environment id and select its deployment region.' },
      { id: 'credentials', title: 'Store worker credentials', detail: 'Save the client id and client secret in the encrypted connection credential bundle.' },
    ],
  },
  onelogin: {
    consoleUrl: 'https://admin.us.onelogin.com/api_credentials',
    credentialFields: [
      {
        label: 'OneLogin API credential bundle',
        description: 'JSON containing clientId, clientSecret, and region (us or eu).',
        example: '{"clientId":"...","clientSecret":"...","region":"us"}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'credentials', title: 'Create API credentials', detail: 'Create dedicated OneLogin API credentials with Manage users or the smallest sufficient privilege.' },
      { id: 'region', title: 'Select tenant region', detail: 'Choose us or eu to pin both token and API requests to the tenant region.' },
      { id: 'store', title: 'Store credentials', detail: 'Save the client id and client secret in the encrypted connection credential bundle.' },
    ],
  },
  scim: {
    credentialFields: [
      {
        label: 'SCIM bearer token',
        description: 'Long-lived bearer token issued by the customer SCIM service provider.',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'endpoint', title: 'Record the SCIM base URL', detail: 'Use the public HTTPS SCIM 2.0 root, including any tenant path such as /scim/v2.' },
      { id: 'token', title: 'Create a provisioning token', detail: 'Issue a dedicated least-privileged bearer token for users, groups, and membership operations.' },
      { id: 'test', title: 'Test ServiceProviderConfig', detail: 'Verify the endpoint and token can read the SCIM ServiceProviderConfig resource.' },
    ],
    knownQuirks: [
      { id: 'provider-variance', severity: 'warning', message: 'SCIM providers vary in supported filters, PATCH paths, and ETag behavior; use provider-native PatchOp payloads when a service diverges from RFC 7644.' },
    ],
  },
  affinity: {
    consoleUrl: 'https://support.affinity.co/s/article/How-to-Create-and-Manage-API-Keys',
    credentialFields: [
      {
        label: 'Affinity API key',
        description: 'Bearer API key created by an Affinity workspace administrator. API availability and record access follow the workspace plan and key owner permissions.',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'check-plan', title: 'Confirm API access', detail: 'Confirm the workspace plan includes Affinity API access.' },
      { id: 'create-key', title: 'Create an API key', detail: 'Create a dedicated key under Affinity Settings > API using a least-privileged integration user.' },
      { id: 'paste-key', title: 'Paste the API key', detail: 'Paste the key once. Tangle Hub seals it before persistence.' },
    ],
    knownQuirks: [
      { id: 'user-permissions', severity: 'warning', message: 'The key inherits its creator’s list-level and record permissions; missing records can be an authorization issue rather than a synchronization failure.' },
    ],
  },
  dealcloud: {
    consoleUrl: 'https://api.docs.dealcloud.com/',
    consoleSteps: [
      { id: 'contract', title: 'Confirm DealCloud API access', detail: 'Ask the DealCloud administrator or Intapp account team to enable API access for the customer site.' },
      { id: 'schema-contract', title: 'Publish a schema contract', detail: 'Publish a scoped Schema Contract that names the entry types and fields Tangle may synchronize.' },
      { id: 'credentials', title: 'Issue integration credentials', detail: 'Create customer-site credentials restricted to the published contract and Publications required for incremental synchronization.' },
    ],
    credentialFields: [],
    knownQuirks: [
      { id: 'commercial-access', severity: 'critical', message: 'DealCloud API access is customer-site and contract dependent. This entry remains non-executable until the customer supplies an approved schema contract, site URL, and credentials.' },
      { id: 'custom-schema', severity: 'warning', message: 'Every DealCloud site is customized; map through the published Schema Contract instead of assuming global object or field names.' },
    ],
  },
  otter: {
    consoleUrl: 'https://otter.ai/',
    consoleSteps: [
      { id: 'contract', title: 'Confirm Otter API access', detail: 'Confirm the customer plan and commercial agreement include supported API access for transcripts and meeting metadata.' },
      { id: 'credentials', title: 'Request integration credentials', detail: 'Obtain provider-issued credentials and the permitted workspace/account scope from Otter.' },
      { id: 'scope', title: 'Record permitted data use', detail: 'Record retention, participant-consent, and transcript access rules before enabling ingestion.' },
    ],
    credentialFields: [],
    knownQuirks: [
      { id: 'no-public-self-serve-api', severity: 'critical', message: 'No generally available self-serve Otter API credential flow is documented. This entry is contract-only until provider-approved access exists.' },
    ],
  },
  zoom: {
    consoleUrl: 'https://marketplace.zoom.us/develop/create',
    consoleSteps: [
      { id: 'app', title: 'Create a General App', detail: 'Create a user-managed General App in Zoom App Marketplace.' },
      { id: 'redirect', title: 'Add callback URL', detail: 'Add {redirectUri} as the OAuth redirect URL.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Add granular scopes', detail: 'Add the user, meeting, webinar, and recording scopes listed by this integration.' },
      { id: 'events', title: 'Enable event subscriptions', detail: 'Subscribe the Hub callback to meeting, recording, and transcript completion events needed by workflows.' },
    ],
  },
  'microsoft-forms': {
    consoleUrl: 'https://learn.microsoft.com/microsoft-365/community/working-with-microsoft-forms-using-microsoft-graph',
    consoleSteps: [
      { id: 'confirm-api', title: 'Confirm supported Forms access', detail: 'Confirm the customer has a provider-supported Microsoft Forms API path for the required tenant and form ownership model.' },
      { id: 'approve', title: 'Approve tenant access', detail: 'Document the tenant administrator approval and the specific forms Tangle may read.' },
    ],
    credentialFields: [],
    knownQuirks: [
      { id: 'no-supported-graph-surface', severity: 'critical', message: 'Microsoft Graph does not expose a generally supported Forms response API. This entry stays non-executable until Microsoft provides or approves a supported access path.' },
    ],
  },
  'microsoft-word': {
    consoleUrl: 'https://learn.microsoft.com/graph/api/resources/onedrive',
    consoleSteps: [
      { id: 'use-files', title: 'Connect OneDrive or SharePoint', detail: 'Use the existing OneDrive or SharePoint connector for Word file discovery, permissions, versions, and download/upload.' },
      { id: 'confirm-edit-api', title: 'Confirm document editing API', detail: 'Before enabling document-body edits, confirm a provider-supported Word editing API and tenant authorization path.' },
    ],
    credentialFields: [],
    knownQuirks: [
      { id: 'files-not-document-model', severity: 'critical', message: 'Microsoft Graph supports Word files through OneDrive and SharePoint but does not expose the full Word document object model. This entry stays non-executable for document-body actions.' },
    ],
  },
  // ── Stripe pack ────────────────────────────────────────────────────
  // Stripe issues two key types: secret keys (sk_*) and restricted keys
  // (rk_*). For voice-agent workloads, restricted keys are the right call
  // — least-privilege scoped to the specific resources the agent can
  // touch. The hint nudges operators toward that path.
  'stripe-pack': {
    consoleUrl: 'https://dashboard.stripe.com/apikeys',
    credentialFields: [
      {
        label: 'Stripe secret key',
        description:
          'Restricted key recommended. Dashboard → Developers → API keys → Create restricted key. ' +
          'Grant write access on Customers, Invoices, and Checkout Sessions.',
        example: 'sk_live_… or rk_live_… (use sk_test_… / rk_test_… for staging)',
        regex: '^(sk|rk)_(live|test)_[A-Za-z0-9]+$',
        secret: true,
      },
    ],
    consoleSteps: [
      {
        id: 'open-keys',
        title: 'Open Stripe API keys',
        detail: 'Visit https://dashboard.stripe.com/apikeys',
        copyValue: 'https://dashboard.stripe.com/apikeys',
      },
      {
        id: 'create-restricted',
        title: 'Create a restricted key',
        detail:
          'Click "Create restricted key". Name it something descriptive ' +
          '(e.g. "ph0ny voice agent — prod"). Grant WRITE on Customers, ' +
          'Invoices, and Checkout Sessions. Leave everything else NONE.',
      },
      {
        id: 'paste',
        title: 'Paste the key',
        detail:
          'Copy the key Stripe shows once (rk_live_… or sk_live_…). ' +
          'Paste it into ph0ny. The key is sealed before persistence.',
      },
    ],
  },

  // ── Twilio SMS ─────────────────────────────────────────────────────
  // Twilio's REST API uses Basic auth with two parts: Account SID
  // (public-ish, AC…) + Auth Token (secret). The default api-key family
  // only exposes one field, which doesn't fit. Providing both fields
  // explicitly lets the consumer's UI render two inputs.
  'twilio-sms': {
    consoleUrl: 'https://console.twilio.com/',
    credentialFields: [
      {
        label: 'Account SID',
        description: 'Your Twilio Account SID. Console → Account → API keys & tokens.',
        example: 'AC… (34 hex chars)',
        regex: '^AC[a-f0-9]{32}$',
        secret: false,
      },
      {
        label: 'Auth Token',
        description:
          'Your Twilio Auth Token (or Standard API Key secret). ' +
          'Use a non-primary auth token in production so rotating it ' +
          "won't break other Twilio integrations.",
        secret: true,
      },
    ],
    consoleSteps: [
      {
        id: 'open',
        title: 'Open Twilio console',
        detail: 'Visit https://console.twilio.com/',
        copyValue: 'https://console.twilio.com/',
      },
      {
        id: 'find',
        title: 'Find your Account SID + Auth Token',
        detail:
          'Account info is on the dashboard home. For better security, ' +
          'create a Standard API Key (Account → API keys & tokens → Create ' +
          'API Key) and use the SID + Secret pair instead of the primary ' +
          'auth token.',
      },
      {
        id: 'paste',
        title: 'Paste both values',
        detail: 'Account SID is non-secret; Auth Token is sealed before persistence.',
      },
    ],
    knownQuirks: [
      {
        id: 'subaccount-tokens',
        severity: 'info',
        message:
          'If you use Twilio subaccounts, paste the SID/Token of the ' +
          'subaccount that owns the phone numbers your agent calls — not ' +
          'the master account.',
      },
    ],
  },

  // ── ph0ny ──────────────────────────────────────────────────────────
  // ph0ny issues a single Bearer API key per developer. The key is a
  // `plabs_` prefix followed by 32 url-safe nanoid chars. It is shown once
  // at creation (POST /v1/keys in the developer portal); only its hash is
  // stored server-side, so it cannot be retrieved later — rotate to replace.
  phony: {
    consoleUrl: 'https://api.ph0ny.com',
    credentialFields: [
      {
        label: 'ph0ny API key',
        description:
          'Bearer key issued by ph0ny. Create one in the developer portal ' +
          '(POST /v1/keys). Sent as `Authorization: Bearer <key>`.',
        example: 'plabs_V1StGXR8Z5jdHi6BmyTAbCdEfGhIjKlm',
        regex: '^plabs_[A-Za-z0-9_-]{32}$',
        secret: true,
      },
    ],
    consoleSteps: [
      {
        id: 'open-portal',
        title: 'Open the ph0ny developer portal',
        detail: 'Visit https://api.ph0ny.com and sign in to the developer portal.',
        copyValue: 'https://api.ph0ny.com',
      },
      {
        id: 'create-key',
        title: 'Create an API key',
        detail:
          'In the portal, create a new API key (POST /v1/keys). Give it a ' +
          'descriptive name (e.g. "tangle agent — prod"). ph0ny returns the ' +
          'full key exactly once.',
      },
      {
        id: 'paste',
        title: 'Paste the key',
        detail:
          'Copy the plabs_… key ph0ny shows and paste it here. The key is ' +
          'sealed before persistence.',
      },
    ],
    knownQuirks: [
      {
        id: 'key-shown-once',
        severity: 'warning',
        message:
          'ph0ny stores only a hash of the key — the full plabs_… value is ' +
          'shown exactly once at creation and cannot be retrieved later. Save ' +
          'it immediately; if lost, rotate to issue a replacement.',
      },
      {
        id: 'rotate-endpoint',
        severity: 'info',
        message:
          'Rotate a key with POST /v1/keys/:id/rotate. The old key is revoked ' +
          'and a new plabs_… key is returned once — update this connection ' +
          'with the new value.',
      },
    ],
  },
}

/** Public read — undefined when no override exists for the kind. */
export function getIntegrationOverride(kind: string): IntegrationOverride | undefined {
  return INTEGRATION_OVERRIDES[kind]
}
