import type { IntegrationFamilyId, IntegrationFamilySpec } from './types.js'

export const INTEGRATION_FAMILIES: Record<IntegrationFamilyId, IntegrationFamilySpec> = {
  google: {
    id: 'google',
    title: 'Google OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://console.cloud.google.com/apis/credentials',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/google/callback',
    credentialFields: [
      { label: 'Client ID', env: 'GOOGLE_OAUTH_CLIENT_ID', description: 'Google OAuth client ID.', example: '1234567890-abc.apps.googleusercontent.com', regex: '^[0-9]+-[a-zA-Z0-9_-]+\\.apps\\.googleusercontent\\.com$', secret: false },
      { label: 'Client Secret', env: 'GOOGLE_OAUTH_CLIENT_SECRET', description: 'Google OAuth client secret.', example: 'GOCSPX-...', secret: true },
    ],
    consoleSteps: [
      { id: 'project', title: 'Select project', detail: 'Open Google Cloud Console and select the project that owns the OAuth client.' },
      { id: 'consent', title: 'Configure consent screen', detail: 'Configure OAuth consent, app name, support email, and publishing status appropriate for the deployment.' },
      { id: 'client', title: 'Create web client', detail: 'Create an OAuth client of type Web application.' },
      { id: 'redirect', title: 'Add redirect URI', detail: 'Add {redirectUri} as an authorized redirect URI.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Add scopes', detail: 'Add the provider scopes listed in this spec.' },
    ],
    knownQuirks: [
      { id: 'offline-access', severity: 'warning', message: 'Use access_type=offline and prompt=consent when refresh tokens are required.' },
      { id: 'verification', severity: 'warning', message: 'Sensitive or restricted scopes may require Google verification before broad external use.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: true, supportsIncrementalAuth: true, recommendedHealthcheckIntervalHours: 24 },
  },
  'microsoft-graph': {
    id: 'microsoft-graph',
    title: 'Microsoft Graph OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/microsoft/callback',
    credentialFields: [
      { label: 'Client ID', env: 'MS_OAUTH_CLIENT_ID', description: 'Microsoft Entra application client ID.', example: '00000000-0000-0000-0000-000000000000', regex: '^[0-9a-fA-F-]{36}$', secret: false },
      { label: 'Client Secret', env: 'MS_OAUTH_CLIENT_SECRET', description: 'Microsoft Entra client secret value.', secret: true },
    ],
    consoleSteps: [
      { id: 'app', title: 'Register app', detail: 'Create or open an app registration in Microsoft Entra.' },
      { id: 'redirect', title: 'Add redirect URI', detail: 'Add {redirectUri} as a Web redirect URI.', copyValue: '{redirectUri}' },
      { id: 'secret', title: 'Create secret', detail: 'Create a client secret and store the secret value, not the secret ID.' },
      { id: 'permissions', title: 'Add Graph permissions', detail: 'Add the delegated Graph scopes listed in this spec and grant admin consent where required.' },
    ],
    knownQuirks: [
      { id: 'tenant-common', severity: 'info', message: 'The common tenant supports multi-tenant OAuth; single-tenant deployments should override the tenant segment.' },
      { id: 'admin-consent', severity: 'warning', message: 'Some Graph scopes require tenant admin consent.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: true, supportsIncrementalAuth: true, recommendedHealthcheckIntervalHours: 24 },
  },
  atlassian: {
    id: 'atlassian',
    title: 'Atlassian OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://developer.atlassian.com/console/myapps/',
    authorizationUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/atlassian/callback',
    credentialFields: [
      { label: 'Client ID', description: 'Atlassian OAuth client ID.', secret: false },
      { label: 'Client Secret', description: 'Atlassian OAuth client secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'app', title: 'Create OAuth app', detail: 'Create an OAuth 2.0 app in the Atlassian developer console.' },
      { id: 'redirect', title: 'Add callback URL', detail: 'Add {redirectUri} as the callback URL.', copyValue: '{redirectUri}' },
      { id: 'apis', title: 'Enable APIs', detail: 'Enable the Jira or Confluence APIs required by this connector.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: false, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  salesforce: {
    id: 'salesforce',
    title: 'Salesforce OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://login.salesforce.com',
    authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/salesforce/callback',
    credentialFields: [
      { label: 'Client ID', env: 'SALESFORCE_OAUTH_CLIENT_ID', description: 'Salesforce connected app consumer key.', secret: false },
      { label: 'Client Secret', env: 'SALESFORCE_OAUTH_CLIENT_SECRET', description: 'Salesforce connected app consumer secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'connected-app', title: 'Create connected app', detail: 'Create a Salesforce connected app with OAuth enabled.' },
      { id: 'callback', title: 'Add callback URL', detail: 'Add {redirectUri} as the callback URL.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Select scopes', detail: 'Add api and refresh_token/offline_access, plus any connector-specific scopes.' },
    ],
    knownQuirks: [
      { id: 'instance-url', severity: 'critical', message: 'Runtime calls must use the instance_url returned by the token response.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  hubspot: {
    id: 'hubspot',
    title: 'HubSpot OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://developers.hubspot.com/',
    authorizationUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/hubspot/callback',
    credentialFields: [
      { label: 'Client ID', env: 'HUBSPOT_OAUTH_CLIENT_ID', description: 'HubSpot app client ID.', secret: false },
      { label: 'Client Secret', env: 'HUBSPOT_OAUTH_CLIENT_SECRET', description: 'HubSpot app client secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'app', title: 'Create private/public app', detail: 'Create a HubSpot app and configure OAuth.' },
      { id: 'redirect', title: 'Add redirect URL', detail: 'Add {redirectUri} to the app redirect URLs.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Add CRM scopes', detail: 'Add the CRM object scopes listed in this spec.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  slack: {
    id: 'slack',
    title: 'Slack OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://api.slack.com/apps',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/slack/callback',
    credentialFields: [
      { label: 'Client ID', env: 'SLACK_OAUTH_CLIENT_ID', description: 'Slack app client ID.', secret: false },
      { label: 'Client Secret', env: 'SLACK_OAUTH_CLIENT_SECRET', description: 'Slack app client secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'app', title: 'Create Slack app', detail: 'Create or open a Slack app.' },
      { id: 'redirect', title: 'Add redirect URL', detail: 'Add {redirectUri} under OAuth & Permissions.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Add bot scopes', detail: 'Add the bot token scopes listed in this spec and reinstall the app.' },
    ],
    knownQuirks: [
      { id: 'bot-token', severity: 'info', message: 'Slack usually returns a bot access token; refresh tokens require token rotation.' },
    ],
    lifecycle: { supportsRefresh: false, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  notion: {
    id: 'notion',
    title: 'Notion OAuth',
    authMode: 'oauth2',
    consoleUrl: 'https://www.notion.so/my-integrations',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/notion/callback',
    credentialFields: [
      { label: 'Client ID', env: 'NOTION_OAUTH_CLIENT_ID', description: 'Notion integration OAuth client ID.', secret: false },
      { label: 'Client Secret', env: 'NOTION_OAUTH_CLIENT_SECRET', description: 'Notion integration OAuth client secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'integration', title: 'Create integration', detail: 'Create a Notion public integration.' },
      { id: 'redirect', title: 'Add redirect URI', detail: 'Add {redirectUri} as the redirect URI.', copyValue: '{redirectUri}' },
      { id: 'capabilities', title: 'Select capabilities', detail: 'Enable read/update/insert capabilities matching this connector.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  'standard-oauth2': {
    id: 'standard-oauth2',
    title: 'Standard OAuth 2.0',
    authMode: 'oauth2',
    redirectUriTemplate: 'https://{host}/api/integrations/oauth/{kind}/callback',
    credentialFields: [
      { label: 'Client ID', description: 'OAuth client ID.', secret: false },
      { label: 'Client Secret', description: 'OAuth client secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'app', title: 'Create OAuth app', detail: 'Create an OAuth app in the provider console.' },
      { id: 'redirect', title: 'Add redirect URI', detail: 'Add {redirectUri} as an allowed redirect URI.', copyValue: '{redirectUri}' },
      { id: 'scopes', title: 'Add scopes', detail: 'Add the scopes listed in this spec.' },
    ],
    lifecycle: { supportsRefresh: true, supportsRevoke: false, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  'api-key': {
    id: 'api-key',
    title: 'API key',
    authMode: 'api_key',
    credentialFields: [
      { label: 'API Key', description: 'Provider API key or token.', example: 'sk_...', secret: true },
    ],
    consoleSteps: [
      { id: 'token', title: 'Create token', detail: 'Create an API key/token in the provider console with the minimum required permissions.' },
    ],
    lifecycle: { supportsRefresh: false, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  hmac: {
    id: 'hmac',
    title: 'HMAC secret',
    authMode: 'hmac',
    credentialFields: [
      { label: 'Signing Secret', description: 'Webhook signing secret.', secret: true },
    ],
    consoleSteps: [
      { id: 'secret', title: 'Configure signing secret', detail: 'Configure the shared signing secret in the sender and receiver.' },
    ],
    lifecycle: { supportsRefresh: false, supportsRevoke: true, supportsIncrementalAuth: false, recommendedHealthcheckIntervalHours: 24 },
  },
  none: {
    id: 'none',
    title: 'No authentication',
    authMode: 'none',
    credentialFields: [],
    consoleSteps: [
      { id: 'configure', title: 'Configure endpoint', detail: 'No provider credentials are required.' },
    ],
    lifecycle: { supportsRefresh: false, supportsRevoke: false, supportsIncrementalAuth: false },
  },
}

export function getIntegrationFamily(id: IntegrationFamilyId): IntegrationFamilySpec {
  return INTEGRATION_FAMILIES[id]
}
