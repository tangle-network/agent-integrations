import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Dynamics 365 / Dataverse Web API connector.
 *
 * Auth: OAuth2 against the Microsoft identity platform. The token audience is
 * the organization URL itself (e.g. `https://contoso.crm.dynamics.com/.default`),
 * so the per-tenant Dataverse origin is supplied through `instanceUrl` connection
 * metadata rather than baked into baseUrl. The same connector therefore serves
 * every Dataverse region (crm, crm2..crm9, crm.dynamics.cn, crm.microsoftdynamics.us).
 *
 * Capability surface mirrors the activepieces piece (create / get / update /
 * delete record) but binds them to the Dataverse Web API v9.2 entity-set
 * conventions: pluralized logical names, GUID record ids, and the
 * If-Match: * idempotency header for upserts.
 *
 * Docs:
 *   - https://learn.microsoft.com/power-apps/developer/data-platform/webapi/overview
 *   - https://learn.microsoft.com/power-apps/developer/data-platform/webapi/perform-operations-web-api
 *   - https://learn.microsoft.com/power-apps/developer/data-platform/authenticate-oauth
 */
export const microsoftDynamicsCrmConnector = declarativeRestConnector({
  kind: 'microsoft-dynamics-crm',
  displayName: 'Microsoft Dynamics CRM',
  description:
    'Read, create, update, and delete records in Microsoft Dynamics 365 (Dataverse Web API v9.2).',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'https://globaldisco.crm.dynamics.com/user_impersonation'],
    clientIdEnv: 'MICROSOFT_DYNAMICS_CRM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_DYNAMICS_CRM_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  defaultHeaders: {
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    Prefer: 'return=representation',
  },
  test: { method: 'GET', path: '/api/data/v9.2/WhoAmI' },
  capabilities: [
    {
      name: 'records.get',
      class: 'read',
      description:
        'Read a single record from a Dataverse entity set by GUID. entitySet is the pluralized logical name (e.g. "accounts", "contacts", "leads", "opportunities").',
      parameters: {
        type: 'object',
        properties: {
          entitySet: { type: 'string' },
          recordId: { type: 'string' },
          $select: { type: 'string' },
          $expand: { type: 'string' },
        },
        required: ['entitySet', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/api/data/v9.2/{entitySet}({recordId})',
        query: { $select: '{$select}', $expand: '{$expand}' },
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description:
        'Create a new record in a Dataverse entity set. fields is an OData JSON body keyed by logical attribute names; lookups are written as `@odata.bind` references.',
      parameters: {
        type: 'object',
        properties: {
          entitySet: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['entitySet', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/api/data/v9.2/{entitySet}',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description:
        'Patch attributes on an existing record. Dataverse PATCH against an entity-set key performs an upsert; pass If-Match via the cas policy when update-only semantics are required.',
      parameters: {
        type: 'object',
        properties: {
          entitySet: { type: 'string' },
          recordId: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['entitySet', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/api/data/v9.2/{entitySet}({recordId})',
        body: '{fields}',
      },
      cas: 'etag-if-match',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from a Dataverse entity set by GUID.',
      parameters: {
        type: 'object',
        properties: {
          entitySet: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['entitySet', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/data/v9.2/{entitySet}({recordId})',
      },
      cas: 'native-idempotency',
    },
  ],
})
