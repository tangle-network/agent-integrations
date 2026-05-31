import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Dynamics 365 Business Central — Microsoft's SMB ERP /
 * accounting suite. The public REST surface is the Business Central
 * v2.0 API, addressed as
 *
 *   https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0/companies({companyId})/{entitySetName}
 *
 * The connector keeps the tenant / environment / company tuple on the
 * data-source metadata (`apiBaseUrl`) so each grant can target a
 * different production or sandbox environment without re-deploying.
 * `entitySetName` (e.g., `customers`, `vendors`, `salesInvoices`,
 * `items`) is passed per-call so the same five capabilities cover every
 * standard and custom entity exposed by the tenant — matching the
 * "generic record" verb shape Activepieces ships.
 *
 * Auth: Azure AD v2 OAuth2. `offline_access` is mandatory on v2 to
 * receive a refresh_token; without it Business Central grants silently
 * expire after the access token's first hour and the connector has no
 * way to recover. The scope set requested below is the read+write
 * surface for the standard financials API.
 *
 * CAS: Business Central returns an `@odata.etag` on every entity and
 * honours `If-Match` on PATCH and DELETE, so updates and deletes wire
 * straight to the connector's `etag-if-match` strategy. Creates use
 * `native-idempotency` because the server rejects duplicate
 * `Number`/key values on conflict instead of partially applying.
 */

const TENANT_ID_DOC =
  'Azure AD tenant id (GUID) hosting the Business Central environment. Stored on the data source as metadata.tenantId at connect time.'
const ENVIRONMENT_DOC =
  'Business Central environment name (e.g. "production" or "Sandbox-EU"). Stored on the data source as metadata.environment at connect time.'
const COMPANY_ID_DOC =
  'Business Central company id (GUID). Required for every record operation because the API namespaces entities under companies({companyId}).'
const ENTITY_SET_DOC =
  'OData entity set name on the Business Central API — e.g. customers, vendors, items, salesInvoices, salesOrders, journalLines, dimensions, generalLedgerEntries. Standard and custom entities both work.'

export const microsoftDynamics365BusinessCentralConnector = declarativeRestConnector({
  kind: 'microsoft-dynamics-365-business-central',
  displayName: 'Microsoft Dynamics 365 Business Central',
  description:
    'Read, create, update, delete, and search records in Microsoft Dynamics 365 Business Central — customers, vendors, items, sales invoices, sales orders, journal lines, and any custom OData entity the tenant exposes through the BC v2.0 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'https://api.businesscentral.dynamics.com/Financials.ReadWrite.All',
      'https://api.businesscentral.dynamics.com/user_impersonation',
      // Required on v2 to receive a refresh_token; without it the grant
      // silently dies after the access token's first hour.
      'offline_access',
    ],
    clientIdEnv: 'BUSINESS_CENTRAL_OAUTH_CLIENT_ID',
    clientSecretEnv: 'BUSINESS_CENTRAL_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  // Every grant points at a specific tenant + environment, captured on
  // the data-source metadata under `apiBaseUrl`. Format:
  //   https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0
  baseUrl: {
    metadataKey: 'apiBaseUrl',
    fallback: 'https://api.businesscentral.dynamics.com/v2.0/common/production/api/v2.0',
  },
  // Cheapest probe that proves the grant is live and the
  // tenant/environment tuple resolves: list companies. Returns the set
  // of company GUIDs the connected user can address.
  test: { method: 'GET', path: '/companies' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description:
        'Create a record in a Business Central entity set scoped to a company (Activepieces: Create Record).',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: COMPANY_ID_DOC },
          entitySetName: { type: 'string', description: ENTITY_SET_DOC },
          fields: {
            type: 'object',
            description:
              'Field name -> value payload. Field names match the Business Central entity schema (camelCase, e.g. displayName, number, lineType).',
          },
          tenantId: { type: 'string', description: TENANT_ID_DOC },
          environment: { type: 'string', description: ENVIRONMENT_DOC },
        },
        required: ['companyId', 'entitySetName', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/companies({companyId})/{entitySetName}',
        body: '{fields}',
      },
      // BC rejects duplicate Number / key values on conflict instead of
      // partially applying, so the create path is naturally idempotent
      // when the caller stamps a stable business key into `fields`.
      cas: 'native-idempotency',
      requiredScopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'],
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description:
        'Delete a record from a Business Central entity set by id (Activepieces: Delete Record).',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: COMPANY_ID_DOC },
          entitySetName: { type: 'string', description: ENTITY_SET_DOC },
          recordId: {
            type: 'string',
            description: 'Business Central record id (GUID) of the entity to delete.',
          },
          tenantId: { type: 'string', description: TENANT_ID_DOC },
          environment: { type: 'string', description: ENVIRONMENT_DOC },
        },
        required: ['companyId', 'entitySetName', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/companies({companyId})/{entitySetName}({recordId})',
        // BC honours `If-Match: *` on DELETE; declarative-rest forwards
        // the static header verbatim. Callers that hold an etag from a
        // prior read are still served by the executor's etag plumbing.
        headers: { 'If-Match': '*' },
      },
      cas: 'etag-if-match',
      requiredScopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'],
    },
    {
      name: 'records.get',
      class: 'read',
      description:
        'Read a single Business Central record by id (Activepieces: Get Record). Returns the entity payload plus its `@odata.etag` for downstream CAS updates.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: COMPANY_ID_DOC },
          entitySetName: { type: 'string', description: ENTITY_SET_DOC },
          recordId: {
            type: 'string',
            description: 'Business Central record id (GUID) of the entity to read.',
          },
          expand: {
            type: 'string',
            description:
              'Optional OData $expand expression for navigation properties (e.g. "dimensionSetLines,salesInvoiceLines").',
          },
          tenantId: { type: 'string', description: TENANT_ID_DOC },
          environment: { type: 'string', description: ENVIRONMENT_DOC },
        },
        required: ['companyId', 'entitySetName', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/companies({companyId})/{entitySetName}({recordId})',
        query: { $expand: '{expand}' },
      },
      requiredScopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'],
    },
    {
      name: 'records.search',
      class: 'read',
      description:
        'Search records in a Business Central entity set with OData $filter / $top / $orderby (Activepieces: Search Records).',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: COMPANY_ID_DOC },
          entitySetName: { type: 'string', description: ENTITY_SET_DOC },
          filter: {
            type: 'string',
            description:
              'OData $filter expression, e.g. "displayName eq \'Adatum Corporation\'" or "totalAmountIncludingTax gt 1000".',
          },
          orderby: {
            type: 'string',
            description: 'OData $orderby expression, e.g. "lastModifiedDateTime desc".',
          },
          top: {
            type: 'integer',
            minimum: 1,
            maximum: 20000,
            description: 'OData $top page size. BC caps the page at 20,000 rows.',
          },
          skip: {
            type: 'integer',
            minimum: 0,
            description: 'OData $skip offset for paging.',
          },
          select: {
            type: 'string',
            description:
              'Optional OData $select to narrow the projection, e.g. "id,number,displayName".',
          },
          tenantId: { type: 'string', description: TENANT_ID_DOC },
          environment: { type: 'string', description: ENVIRONMENT_DOC },
        },
        required: ['companyId', 'entitySetName'],
      },
      request: {
        method: 'GET',
        path: '/companies({companyId})/{entitySetName}',
        query: {
          $filter: '{filter}',
          $orderby: '{orderby}',
          $top: '{top}',
          $skip: '{skip}',
          $select: '{select}',
        },
      },
      requiredScopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'],
    },
    {
      name: 'records.update',
      class: 'mutation',
      description:
        'Patch a Business Central record by id (Activepieces: Update Record). Only the supplied fields are written; everything else is preserved.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string', description: COMPANY_ID_DOC },
          entitySetName: { type: 'string', description: ENTITY_SET_DOC },
          recordId: {
            type: 'string',
            description: 'Business Central record id (GUID) of the entity to update.',
          },
          fields: {
            type: 'object',
            description:
              'Field name -> value patch payload. Field names match the Business Central entity schema.',
          },
          tenantId: { type: 'string', description: TENANT_ID_DOC },
          environment: { type: 'string', description: ENVIRONMENT_DOC },
        },
        required: ['companyId', 'entitySetName', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/companies({companyId})/{entitySetName}({recordId})',
        body: '{fields}',
        // declarative-rest forwards the literal header. The connector
        // executor layers an `If-Match: <etag>` on top when the caller
        // supplies one via the etag flow; this `*` is the
        // last-writer-wins fallback for callers that don't.
        headers: { 'If-Match': '*' },
      },
      cas: 'etag-if-match',
      requiredScopes: ['https://api.businesscentral.dynamics.com/Financials.ReadWrite.All'],
    },
  ],
})
