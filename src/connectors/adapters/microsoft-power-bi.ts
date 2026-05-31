import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Power BI connector backed by the Power BI REST API v1.0.
 *
 * Auth: OAuth2 against the Entra ID v2.0 endpoint. The `common` tenant lets a
 * single app registration work for multi-tenant deployments; single-tenant
 * operators override authorizationUrl/tokenUrl with their tenant id at
 * construction time.
 *
 * Power BI dataset writes are not natively idempotent — pushRows is append-only
 * and createDataset rejects duplicate names within a workspace — so callers must
 * gate replay at the orchestration layer (idempotency key + workspace-scoped
 * name uniqueness check) rather than rely on the API.
 *
 * Docs:
 *   - https://learn.microsoft.com/rest/api/power-bi/datasets/post-dataset
 *   - https://learn.microsoft.com/rest/api/power-bi/push-datasets/datasets-post-rows
 */
export const microsoftPowerBiConnector = declarativeRestConnector({
  kind: 'microsoft-power-bi',
  displayName: 'Microsoft Power BI',
  description:
    'Create push datasets in Microsoft Power BI and stream rows into their tables.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
      'https://analysis.windows.net/powerbi/api/Workspace.Read.All',
    ],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.powerbi.com/v1.0/myorg',
  // GET /groups — cheap liveness probe; returns the workspaces the bearer token
  // can see and exercises the Power BI scope set.
  test: { method: 'GET', path: '/groups' },
  capabilities: [
    {
      name: 'create.dataset',
      class: 'mutation',
      description:
        'Create a Power BI push dataset in a workspace (group). The dataset payload describes table schemas; defaultMode "Push" is required for downstream rows.push calls.',
      parameters: {
        type: 'object',
        properties: {
          groupId: {
            type: 'string',
            description: 'Power BI workspace (group) id that will own the dataset.',
          },
          name: {
            type: 'string',
            description: 'Display name for the dataset within the workspace.',
          },
          defaultMode: {
            type: 'string',
            enum: ['Push', 'Streaming', 'PushStreaming'],
            description:
              'Dataset mode. Push is the default for REST-fed datasets; Streaming/PushStreaming enable real-time tiles.',
          },
          tables: {
            type: 'array',
            description:
              'Table schemas. Each entry carries { name, columns: [{ name, dataType }] } per the Power BI dataset spec.',
            items: { type: 'object' },
          },
          relationships: {
            type: 'array',
            description: 'Optional relationship definitions between tables.',
            items: { type: 'object' },
          },
        },
        required: ['groupId', 'name', 'tables'],
      },
      request: {
        method: 'POST',
        path: '/groups/{groupId}/datasets',
        body: {
          name: '{name}',
          defaultMode: '{defaultMode}',
          tables: '{tables}',
          relationships: '{relationships}',
        },
      },
      // Power BI rejects duplicate dataset names per workspace with HTTP 400,
      // not 409, so we cannot rely on its 409 path; treat as non-idempotent and
      // let the caller dedupe by (groupId, name) before retrying.
      cas: 'none',
      requiredScopes: [
        'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
      ],
    },
    {
      name: 'push.rows.to.dataset.table',
      class: 'mutation',
      description:
        'Append rows to a table inside an existing Power BI push dataset. Power BI enforces a 10k-rows-per-request / 1MB-payload cap; callers must batch upstream.',
      parameters: {
        type: 'object',
        properties: {
          groupId: {
            type: 'string',
            description: 'Power BI workspace (group) id that owns the dataset.',
          },
          datasetId: {
            type: 'string',
            description: 'Push dataset id returned by create.dataset.',
          },
          tableName: {
            type: 'string',
            description: 'Name of the table inside the dataset to receive the rows.',
          },
          rows: {
            type: 'array',
            description:
              'Row objects whose keys match the table column names defined at dataset creation.',
            items: { type: 'object' },
          },
        },
        required: ['groupId', 'datasetId', 'tableName', 'rows'],
      },
      request: {
        method: 'POST',
        path: '/groups/{groupId}/datasets/{datasetId}/tables/{tableName}/rows',
        body: { rows: '{rows}' },
      },
      // Push rows is append-only and not idempotent on the Power BI side; the
      // caller owns dedup via an idempotency key + outbox before retrying.
      cas: 'none',
      requiredScopes: [
        'https://analysis.windows.net/powerbi/api/Dataset.ReadWrite.All',
      ],
    },
  ],
})
