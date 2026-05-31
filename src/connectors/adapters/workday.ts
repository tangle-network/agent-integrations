import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Workday connector.
 *
 * Auth model: Workday exposes a public OAuth 2.0 authorization-code grant
 * surfaced as an "API Client for Integrations" registered by a Workday
 * tenant administrator. Three properties of that flow shape this adapter:
 *
 *   1. The authorize/token endpoints are tenant-scoped under the tenant's
 *      Workday host:
 *        - Authorize: https://{host}/ccx/oauth2/{tenant}/authorize
 *        - Token:     https://{host}/ccx/oauth2/{tenant}/token
 *      `host` is the Workday data center the tenant lives in (e.g.
 *      `wd5.workday.com`, `wd2-impl-services1.workday.com`); `tenant` is
 *      the customer's tenant id. The operator persists the tenant-resolved
 *      values on the OAuth client record when they register an integration
 *      for that tenant — the manifest below carries the documented URL
 *      shape so the registration UI can prefill it. This mirrors how
 *      Auth0's tenant-scoped Management API authorize/token URLs are
 *      surfaced (see auth0.ts).
 *
 *   2. The REST base URL is ALSO tenant-scoped:
 *        https://{host}/ccx/api/v1/{tenant}
 *      with secondary surfaces at `/ccx/api/staffing/v1/{tenant}`,
 *      `/ccx/api/absenceManagement/v1/{tenant}`, etc. The connection stores
 *      the resolved tenant-scoped origin on `metadata.apiBaseUrl` so a
 *      single OAuth client can fan out per tenant without a per-tenant
 *      build; capability paths stay relative below.
 *
 *   3. Workday's scope vocabulary is "Functional Area" + access level
 *      (Get / Put). The set requested below covers the read + maintain
 *      surface the action pack exercises (workers, organizations,
 *      time-off). Tenant admins enable the matching functional areas on
 *      the API Client; the OAuth `scope` parameter narrows further at
 *      runtime.
 *
 * Capability surface: Workers (list/get), Worker employment details,
 * Organizations (list/get), Locations (list), Time Off (list types, list
 * requests, submit a request) — the HRIS jobs an agent typically wires
 * for onboarding lookups, headcount queries, and PTO workflows. Workday's
 * payroll, recruiting, and absence-balance surfaces are deliberately not
 * modeled here; they live on separate REST endpoints (Payroll, Recruiting,
 * Absence Management) that warrant their own adapters as the action pack
 * widens.
 *
 * Consistency model: `authoritative` — Workday is the system of record
 * for HR data; downstream caches MUST defer to it on conflict.
 *
 * Docs:
 *   - https://community.workday.com/sites/default/files/file-hosting/restapi/index.html
 *   - https://doc.workday.com/admin-guide/en-us/integrations/integration-design/oauth-and-rest-api/dan1370797667399.html
 *   - https://community.workday.com/api-clients-for-integrations
 */
export const workdayConnector = declarativeRestConnector({
  kind: 'workday',
  displayName: 'Workday',
  description:
    'Read Workday workers, organizations, locations, and time-off data and submit time-off requests through the tenant-scoped Workday REST API.',
  auth: {
    kind: 'oauth2',
    // Tenant-scoped at OAuth-client registration time. {host} resolves to
    // the customer's Workday data center (wd5.workday.com, wd2-impl-...),
    // {tenant} to the customer's tenant id. The platform stores the
    // resolved URLs alongside the OAuth client record, the same pattern
    // Auth0 uses for its tenant-scoped Management API client.
    authorizationUrl: 'https://{host}/ccx/oauth2/{tenant}/authorize',
    tokenUrl: 'https://{host}/ccx/oauth2/{tenant}/token',
    // Workday scopes are Functional Area names; the tenant admin enables
    // matching functional areas on the API Client and the OAuth flow
    // narrows further per request. The set below maps to the action pack:
    // Staffing covers workers + employment data; Organizations + Locations
    // cover the org/location reads; Time Off covers PTO list + submit.
    scopes: ['Staffing', 'Organizations and Roles', 'Time Off and Leave'],
    clientIdEnv: 'WORKDAY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WORKDAY_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  // The full tenant-scoped REST origin, e.g.
  //   https://wd5.workday.com/ccx/api/v1/acme
  // Capability paths stay relative so URL resolution keeps the
  // /ccx/api/v1/{tenant} prefix. Staffing-only endpoints below use
  // `../staffing/v1/{tenant}` so the staffing functional surface stays
  // reachable from the same connection without a second base URL.
  baseUrl: { metadataKey: 'apiBaseUrl' },
  defaultHeaders: {
    accept: 'application/json',
  },
  // Workday's documented health-check endpoint is `/workers` with a
  // count=1 limit; it returns 200 + an empty data array when the token
  // is valid but the functional area has no records, which is the
  // behavior the test path expects.
  test: { method: 'GET', path: 'workers', query: { limit: '1' } },
  capabilities: [
    // ---------- Workers ----------
    {
      name: 'workers.list',
      class: 'read',
      description:
        'List workers in the tenant with optional pagination (Workday returns active workers by default; pass `terminated=true` to include terminated workers).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size (Workday max 100).' },
          offset: { type: 'integer', minimum: 0 },
          search: { type: 'string', description: 'Free-text worker search (matches name / preferred name / email).' },
          terminated: { type: 'boolean', description: 'Include terminated workers in the result set.' },
        },
      },
      request: {
        method: 'GET',
        path: 'workers',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          search: '{search}',
          terminated: '{terminated}',
        },
      },
      requiredScopes: ['Staffing'],
    },
    {
      name: 'workers.get',
      class: 'read',
      description: 'Read a single worker record by Workday worker id.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string', description: 'Workday worker WID.' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: 'workers/{workerId}' },
      requiredScopes: ['Staffing'],
    },
    {
      name: 'workers.history',
      class: 'read',
      description:
        'Read a worker employment history, including position, business title, location, and supervisory organization changes over time.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: 'workers/{workerId}/history' },
      requiredScopes: ['Staffing'],
    },
    {
      name: 'workers.directReports',
      class: 'read',
      description: 'List the direct reports of a worker (one supervisory level; recurse for the full tree).',
      parameters: {
        type: 'object',
        properties: {
          workerId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['workerId'],
      },
      request: {
        method: 'GET',
        path: 'workers/{workerId}/directReports',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['Staffing'],
    },

    // ---------- Organizations ----------
    {
      name: 'organizations.list',
      class: 'read',
      description: 'List supervisory organizations (filterable by name) with pagination.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: 'supervisoryOrganizations',
        query: { search: '{search}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['Organizations and Roles'],
    },
    {
      name: 'organizations.get',
      class: 'read',
      description: 'Read a supervisory organization by id (includes manager, members, and parent org link).',
      parameters: {
        type: 'object',
        properties: { organizationId: { type: 'string' } },
        required: ['organizationId'],
      },
      request: { method: 'GET', path: 'supervisoryOrganizations/{organizationId}' },
      requiredScopes: ['Organizations and Roles'],
    },

    // ---------- Locations ----------
    {
      name: 'locations.list',
      class: 'read',
      description: 'List Workday locations (offices, remote pools) with pagination.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: 'locations',
        query: { search: '{search}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['Staffing'],
    },

    // ---------- Time Off ----------
    {
      name: 'timeOff.types.list',
      class: 'read',
      description: 'List time-off plan types available to a worker (PTO, sick, jury duty, …).',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: 'workers/{workerId}/eligibleAbsenceTypes' },
      requiredScopes: ['Time Off and Leave'],
    },
    {
      name: 'timeOff.entries.list',
      class: 'read',
      description: 'List a worker time-off entries within an optional date range.',
      parameters: {
        type: 'object',
        properties: {
          workerId: { type: 'string' },
          fromDate: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
          toDate: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['workerId'],
      },
      request: {
        method: 'GET',
        path: 'workers/{workerId}/timeOffEntries',
        query: {
          fromDate: '{fromDate}',
          toDate: '{toDate}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['Time Off and Leave'],
    },
    {
      name: 'timeOff.submit',
      class: 'mutation',
      description:
        'Submit a time-off request on behalf of a worker. Body MUST follow the Workday request shape: { entries: [{ date, dailyQuantity, timeOffType: { id } }], comment? }.',
      parameters: {
        type: 'object',
        properties: {
          workerId: { type: 'string' },
          entries: {
            type: 'array',
            description: 'One entry per requested day. Each carries the absence type id and daily quantity (in hours).',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
                dailyQuantity: { type: 'string', description: 'Hours as a decimal string (e.g. "8").' },
                timeOffType: {
                  type: 'object',
                  properties: { id: { type: 'string' } },
                  required: ['id'],
                },
              },
              required: ['date', 'dailyQuantity', 'timeOffType'],
            },
          },
          comment: { type: 'string' },
        },
        required: ['workerId', 'entries'],
      },
      request: {
        method: 'POST',
        path: 'workers/{workerId}/requestTimeOff',
        body: { entries: '{entries}', comment: '{comment}' },
      },
      requiredScopes: ['Time Off and Leave'],
      cas: 'native-idempotency',
    },
  ],
})
