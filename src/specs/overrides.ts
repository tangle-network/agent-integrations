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
  rabbitmq: {
    credentialFields: [
      {
        label: 'RabbitMQ connection JSON',
        description: 'JSON containing a public host, username, password, optional port/vhost, and optional CA or mutual-TLS credentials. Verified TLS is mandatory.',
        example: '{"host":"rabbitmq.example.com","port":5671,"username":"tangle","password":"...","vhost":"/tenant"}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'account', title: 'Create a restricted RabbitMQ user', detail: 'Grant only configure, write, and read permissions required for the intended virtual host and resources.' },
      { id: 'tls', title: 'Expose a verified TLS listener', detail: 'Use an AMQPS listener on a public hostname with a valid certificate. Plain AMQP is rejected.' },
      { id: 'credential', title: 'Store the connection JSON', detail: 'Save the host, virtual host, restricted user, password, and optional TLS material in the encrypted credential field.' },
      { id: 'test', title: 'Test the connection', detail: 'The connection check verifies public routing, TLS certificate validation, and RabbitMQ authentication without publishing a message.' },
    ],
    knownQuirks: [
      { id: 'tls-only', severity: 'critical', message: 'Plaintext AMQP is rejected. TLS 1.2 or newer and valid server certificates are mandatory.' },
      { id: 'public-host', severity: 'warning', message: 'Hosted Hub rejects private, loopback, link-local, and mixed public/private DNS targets.' },
      { id: 'publisher-confirms', severity: 'info', message: 'Publish actions wait for broker confirmation and require the target queue or exchange to exist.' },
      { id: 'consumer-runtime', severity: 'warning', message: 'The cataloged Message Received trigger still requires a durable polling worker that persists each event before acknowledging it.' },
    ],
    healthcheck: {
      id: 'rabbitmq.connection',
      level: 'connection',
      description: 'Resolve a public host, negotiate verified TLS, authenticate, and close without publishing.',
    },
  },
  duckdb: {
    consoleSteps: [
      { id: 'ready', title: 'Use the built-in runtime', detail: 'No provider account, endpoint, or credential is required. Each invocation uses a new in-memory database.' },
      { id: 'query', title: 'Use query parameters', detail: 'Pass dynamic values through $1, $2, and the args array instead of interpolating them into SQL.' },
    ],
    knownQuirks: [
      { id: 'ephemeral', severity: 'info', message: 'Tables exist only for one invocation and are discarded immediately afterward.' },
      { id: 'external-access', severity: 'critical', message: 'File, network, extension, and attached-database access is disabled and locked before input tables are loaded.' },
      { id: 'bounded-runtime', severity: 'warning', message: 'Input, output, rows, schema depth and width, memory, threads, and execution time are bounded for hosted Hub safety.' },
      { id: 'integer-json', severity: 'info', message: 'DuckDB 64-bit integer results are serialized as decimal strings so JSON does not lose precision.' },
    ],
    healthcheck: {
      id: 'duckdb.runtime',
      level: 'connection',
      description: 'Open a secured in-memory DuckDB instance and execute SELECT 1.',
    },
  },
  kafka: {
    credentialFields: [
      {
        label: 'Kafka connection JSON',
        description: 'JSON containing public broker host:port entries and optional SASL or mutual-TLS credentials. TLS is always required.',
        example: '{"brokers":["broker.example.com:9093"],"saslMechanism":"scram-sha-512","saslUsername":"...","saslPassword":"..."}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'account', title: 'Create a restricted Kafka principal', detail: 'Grant only the topics, groups, and administrative operations required by approved Tangle workflows.' },
      { id: 'network', title: 'Expose TLS broker endpoints', detail: 'Use public TLS endpoints whose advertised broker addresses also resolve publicly.' },
      { id: 'credential', title: 'Store the connection JSON', detail: 'Paste brokers plus SASL or mutual-TLS credentials into the encrypted connection field.' },
      { id: 'test', title: 'Test topic discovery', detail: 'The connection check verifies public routing, TLS certificates, authentication, and topic-list permission without producing a record.' },
    ],
    knownQuirks: [
      { id: 'tls-only', severity: 'critical', message: 'Plaintext Kafka is rejected. TLS 1.2 or newer and valid broker certificates are mandatory.' },
      { id: 'public-brokers', severity: 'warning', message: 'Every bootstrap and advertised broker address must resolve publicly for hosted Hub execution.' },
      { id: 'consumer-rebalance', severity: 'warning', message: 'A bounded consume joins the supplied consumer group and may rebalance its members, so it always requires approval.' },
      { id: 'explicit-commit', severity: 'critical', message: 'Bounded consume never commits offsets automatically. Commit the returned next offsets only after downstream work succeeds.' },
    ],
    healthcheck: {
      id: 'kafka.connection',
      level: 'connection',
      description: 'Connect over TLS, authenticate, and list topics without producing or consuming records.',
    },
  },
  sftp: {
    credentialFields: [
      {
        label: 'SFTP connection JSON',
        description: 'JSON containing host, username, SHA-256 hostFingerprint, and password or privateKey; optional port, passphrase, and rootPath.',
        example: '{"host":"sftp.example.com","username":"integration","password":"...","hostFingerprint":"SHA256:...","rootPath":"/incoming"}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'account', title: 'Create a restricted SFTP account', detail: 'Use a customer-owned account limited to the directories and operations Tangle needs.' },
      { id: 'fingerprint', title: 'Copy the server fingerprint', detail: 'Obtain the SHA-256 host-key fingerprint from the server administrator or a trusted out-of-band channel.' },
      { id: 'credential', title: 'Store the connection JSON', detail: 'Paste the host, username, authentication secret, host fingerprint, and optional root path into the encrypted connection field.' },
      { id: 'test', title: 'Test the connection', detail: 'The connection check verifies DNS, public routing, the pinned host key, authentication, and the configured root directory.' },
    ],
    knownQuirks: [
      { id: 'public-endpoint', severity: 'warning', message: 'The hosted Hub rejects private and local SFTP targets. Expose a restricted public endpoint or use customer-hosted execution.' },
      { id: 'host-key', severity: 'critical', message: 'Connections fail closed when the server host key differs from the stored SHA-256 fingerprint.' },
      { id: 'root-scope', severity: 'critical', message: 'All paths are confined to rootPath, including after symbolic-link resolution.' },
    ],
    healthcheck: {
      id: 'sftp.connection',
      level: 'connection',
      description: 'Connect, verify the pinned host key, authenticate, and read the current SFTP directory without modifying files.',
    },
  },
  'azure-event-grid': {
    consoleUrl: 'https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.EventGrid%2Ftopics',
    credentialFields: [
      {
        label: 'Azure Event Grid credential bundle',
        description: 'JSON containing the custom topic or domain endpoint, one topic access key, and a random delivery secret of at least 32 characters.',
        example: '{"endpoint":"https://topic.region.eventgrid.azure.net/api/events","accessKey":"...","deliverySecret":"..."}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'topic', title: 'Select a custom topic or domain', detail: 'Open the customer-owned Event Grid topic or domain and copy its /api/events endpoint.' },
      { id: 'key', title: 'Copy one topic access key', detail: 'Use either active key and rotate between the primary and secondary keys without downtime.' },
      { id: 'secret', title: 'Generate a delivery secret', detail: 'Generate at least 32 random characters and store it with the endpoint and access key.' },
      { id: 'subscription', title: 'Configure authenticated delivery', detail: 'On each event subscription, add x-tangle-eventgrid-secret as a static secret delivery header with the same value.' },
    ],
    knownQuirks: [
      { id: 'static-health', severity: 'info', message: 'The setup check validates endpoint and credential structure. A live publish would create a real external event and remains approval-gated.' },
      { id: 'delivery-secret', severity: 'critical', message: 'Inbound delivery is rejected unless the event subscription sends the matching x-tangle-eventgrid-secret static delivery header.' },
    ],
    healthcheck: {
      id: 'azure-event-grid.credentials',
      level: 'static',
      description: 'Validate endpoint, topic key, and delivery-secret structure without publishing an event.',
    },
  },
  'azure-service-bus': {
    consoleUrl: 'https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.ServiceBus%2Fnamespaces',
    credentialFields: [
      {
        label: 'Azure Service Bus connection string',
        description: 'Use a dedicated shared access policy with only Send, Listen, or Manage rights required by approved workflows. EntityPath may restrict the connection to one queue or topic.',
        example: 'Endpoint=sb://namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=optional',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'namespace', title: 'Select the customer namespace', detail: 'Open the existing Azure Service Bus namespace or create one under the customer subscription.' },
      { id: 'policy', title: 'Create a narrow shared access policy', detail: 'Grant only Send, Listen, or Manage rights required by approved workflows.' },
      { id: 'entity', title: 'Prefer an entity-scoped connection', detail: 'Use a queue or topic EntityPath when namespace-wide discovery is not required.' },
      { id: 'store', title: 'Store the connection string', detail: 'Copy the primary or secondary connection string into the encrypted connection credential field.' },
    ],
    knownQuirks: [
      { id: 'destructive-receive', severity: 'critical', message: 'Receive-and-delete permanently removes the message as it is returned. Use it only when downstream handling can tolerate loss after a process failure.' },
      { id: 'format-only-health', severity: 'info', message: 'The setup health check validates connection-string structure without consuming or sending a message. Live permissions are confirmed on the first approved operation.' },
    ],
    healthcheck: {
      id: 'azure-service-bus.credentials',
      level: 'static',
      description: 'Validate the Azure Service Bus connection-string structure without sending or consuming a message.',
    },
  },
  'gcloud-pubsub': {
    consoleUrl: 'https://console.cloud.google.com/cloudpubsub',
    credentialFields: [
      {
        label: 'Google Cloud service-account key JSON',
        description: 'Create a dedicated service account, grant only the required Pub/Sub roles, and paste its downloaded JSON key.',
        example: '{"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'api', title: 'Enable the Pub/Sub API', detail: 'Enable Google Cloud Pub/Sub for the customer project.' },
      { id: 'service-account', title: 'Create a service account', detail: 'Create a dedicated Tangle Integration Hub service account.' },
      { id: 'roles', title: 'Grant narrow Pub/Sub roles', detail: 'Grant only viewer, publisher, subscriber, or editor access required by approved workflows.' },
      { id: 'key', title: 'Create and store a JSON key', detail: 'Create one JSON key and save it in the encrypted connection credential field.' },
    ],
    knownQuirks: [
      { id: 'at-least-once', severity: 'warning', message: 'Pub/Sub delivery is at-least-once by default. Consumers must deduplicate messages by a stable application identifier.' },
      { id: 'pull-ack', severity: 'warning', message: 'Pulling a message starts its acknowledgement deadline. Acknowledge it only after downstream work succeeds.' },
    ],
  },
  'digital-ocean': {
    consoleUrl: 'https://cloud.digitalocean.com/account/api/tokens',
    credentialFields: [{ label: 'DigitalOcean personal access token', description: 'Create a dedicated token with only the read or write scopes required by approved workflows.', secret: true }],
    consoleSteps: [
      { id: 'token', title: 'Create a scoped token', detail: 'Create a dedicated token under API > Tokens with the smallest required scopes.' },
      { id: 'projects', title: 'Limit resource ownership', detail: 'Use dedicated projects and tags so connected automation touches only intended resources.' },
      { id: 'store', title: 'Store the token', detail: 'Paste the token once. Tangle Hub seals it before persistence.' },
    ],
    knownQuirks: [
      { id: 'billable-resources', severity: 'critical', message: 'Droplet, database, volume, and app creation can incur immediate charges. Keep all create, resize, action, and delete operations approval-gated.' },
      { id: 'irreversible-delete', severity: 'critical', message: 'Resource deletion can permanently destroy data. Require explicit destructive-action approval and verified backups.' },
    ],
  },
  clicksend: {
    consoleUrl: 'https://dashboard.clicksend.com/#/account/subaccounts',
    credentialFields: [
      {
        label: 'ClickSend API credential bundle',
        description: 'JSON containing username and apiKey from the ClickSend dashboard.',
        example: '{"username":"...","apiKey":"..."}',
        secret: true,
      },
    ],
    consoleSteps: [
      { id: 'account', title: 'Use a dedicated subaccount', detail: 'Create a restricted subaccount for Tangle Integration Hub when account isolation is required.' },
      { id: 'credentials', title: 'Copy API credentials', detail: 'Copy the ClickSend username and API key into the encrypted credential bundle.' },
      { id: 'sender', title: 'Configure approved senders', detail: 'Register and approve sender names or numbers before enabling outbound workflows.' },
    ],
    knownQuirks: [
      { id: 'paid-delivery', severity: 'warning', message: 'Outbound SMS and voice delivery incurs provider charges. Connection health and read operations do not send messages; keep outbound actions approval-gated.' },
      { id: 'sender-rules', severity: 'warning', message: 'Sender ID, consent, quiet-hours, and opt-out rules vary by destination country and remain the customer’s responsibility.' },
    ],
  },
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
