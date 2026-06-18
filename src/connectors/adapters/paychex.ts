import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Paychex API — HR/payroll reads over companies, workers, compensation, and
 * pay rates.
 *
 * Auth is OAuth2 with the CLIENT_CREDENTIALS grant (machine-to-machine): there
 * is NO user-facing authorization step. The platform exchanges the registered
 * client id/secret at `https://api.paychex.com/auth/oauth/v2/token`
 * (application/x-www-form-urlencoded, `grant_type=client_credentials`, no
 * scopes param) and injects the resulting access token; the runtime then sends
 * `Authorization: Bearer`. The manifest declares `grantType:
 * 'client_credentials'` and omits `authorizationUrl` accordingly.
 *
 * The base URL defaults to production but can be overridden per connection via
 * `metadata.apiBaseUri` (e.g. an n1/UAT sandbox host). All responses are JSON
 * and use HATEOAS `links[]` for sub-resource navigation.
 *
 * Reads follow an ID-resolution chain: GET /companies → companyId; GET
 * /companies/{companyId}/workers → workerId; then the per-worker endpoints
 * (profile, compensation, pay rates, communications, federal tax) take that
 * workerId. NOTE the pay-rates path includes the `/compensation/` segment —
 * `/workers/{workerId}/compensation/payrates` — not the `/workers/{workerId}/
 * payrates` form some third-party docs show.
 *
 * Scope is limited to endpoints backed by official Paychex developer docs;
 * payroll checks / pay-periods / pay-components exist but were only
 * third-party-corroborated, so they are intentionally omitted here.
 */
export const paychexConnector = declarativeRestConnector({
  kind: 'paychex',
  displayName: 'Paychex',
  description:
    'Read HR and payroll data from Paychex: companies, workers, worker profiles, compensation, pay rates, communications, and federal tax setup.',
  auth: {
    kind: 'oauth2',
    grantType: 'client_credentials',
    tokenUrl: 'https://api.paychex.com/auth/oauth/v2/token',
    scopes: [],
    clientIdEnv: 'PAYCHEX_OAUTH_CLIENT_ID',
    clientSecretEnv: 'PAYCHEX_OAUTH_CLIENT_SECRET',
  },
  category: 'hr',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUri', fallback: 'https://api.paychex.com' },
  // Listing companies is the cheapest read that proves the client-credentials
  // token is valid and the app has been granted access.
  test: { method: 'GET', path: '/companies' },
  capabilities: [
    {
      name: 'companies.list',
      class: 'read',
      description:
        'List all companies the app has been granted access to. Each carries the companyId (UUID) needed for company-scoped calls.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Page size, max 100 (default 25).' },
          offset: { type: 'integer', description: 'Zero-based pagination offset.' },
          displayid: { type: 'string', description: 'Filter by the company display id.' },
        },
      },
      request: {
        method: 'GET',
        path: '/companies',
        query: { limit: '{limit}', offset: '{offset}', displayid: '{displayid}' },
      },
    },
    {
      name: 'companies.get',
      class: 'read',
      description: 'Read a single company by companyId.',
      parameters: {
        type: 'object',
        properties: { companyId: { type: 'string' } },
        required: ['companyId'],
      },
      request: { method: 'GET', path: '/companies/{companyId}' },
    },
    {
      name: 'companies.workers.list',
      class: 'read',
      description:
        'List workers (employees + contractors) for a company. Minimal fields per worker (givenName, familyName, legalId, workerId); sub-resources are separate calls. Use statusType=ACTIVE to exclude terminated workers.',
      parameters: {
        type: 'object',
        properties: {
          companyId: { type: 'string' },
          limit: { type: 'integer', description: 'Page size, max 100.' },
          offset: { type: 'integer' },
          statusType: { type: 'string', description: 'e.g. ACTIVE to exclude terminated workers.' },
          employeeId: { type: 'string', description: 'Filter to a specific employee id.' },
        },
        required: ['companyId'],
      },
      request: {
        method: 'GET',
        path: '/companies/{companyId}/workers',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          statusType: '{statusType}',
          employeeId: '{employeeId}',
        },
      },
    },
    {
      name: 'workers.get',
      class: 'read',
      description: 'Full profile for a single worker: demographics, employment type, hire date, current status, job info.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: '/workers/{workerId}' },
    },
    {
      name: 'workers.compensation.get',
      class: 'read',
      description:
        'Compensation overview for a worker: payFrequency, flsaStatus, calculatedAnnualPay, calculatedPayPeriod, defaultOvertimeFactor (with HATEOAS links to payrates and paystandards).',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: '/workers/{workerId}/compensation' },
    },
    {
      name: 'workers.compensation.payrates.list',
      class: 'read',
      description:
        'All pay rate profiles for a worker (up to 25): rateId, startDate, rateType, amount, standardHours, standardOvertime. `asof` scopes to an effective date.',
      parameters: {
        type: 'object',
        properties: {
          workerId: { type: 'string' },
          asof: { type: 'string', description: 'Effective date to scope the rates to (YYYY-MM-DD).' },
        },
        required: ['workerId'],
      },
      request: {
        method: 'GET',
        path: '/workers/{workerId}/compensation/payrates',
        query: { asof: '{asof}' },
      },
    },
    {
      name: 'workers.compensation.paystandards.get',
      class: 'read',
      description:
        'Pay standards for a worker: payFrequency (WEEKLY/BI_WEEKLY/SEMI_MONTHLY/MONTHLY), defaultOvertimeFactor, calculatedPayPeriod, calculatedAnnualSalary.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: '/workers/{workerId}/compensation/paystandards' },
    },
    {
      name: 'workers.communications.list',
      class: 'read',
      description: 'Worker contact info (email addresses, phone numbers) — not embedded in the base worker profile.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: '/workers/{workerId}/communications' },
    },
    {
      name: 'workers.federaltax.get',
      class: 'read',
      description: 'W-4 federal tax withholding configuration for a worker.',
      parameters: {
        type: 'object',
        properties: { workerId: { type: 'string' } },
        required: ['workerId'],
      },
      request: { method: 'GET', path: '/workers/{workerId}/federaltax' },
    },
  ],
})
