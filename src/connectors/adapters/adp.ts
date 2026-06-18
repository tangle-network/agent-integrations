import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ADP (Workforce Now / ADP Marketplace) — HR/payroll reads over workers, worker
 * demographics, pay statements, and pay distributions.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ RUNTIME GAP — MANDATORY mTLS. NOT EXECUTABLE THROUGH THE SHARED RUNTIME.  │
 * │                                                                           │
 * │ ADP requires MUTUAL TLS (a client X.509 certificate, CSR-signed by ADP)  │
 * │ presented at the TLS handshake on EVERY call — both the token endpoint   │
 * │ (accounts.adp.com) and the data gateway (api.adp.com). The shared        │
 * │ declarative-REST fetch path cannot attach a client certificate to its    │
 * │ outbound TLS connection, so every request here will fail the handshake   │
 * │ until per-connection client-cert plumbing is added to the runtime.       │
 * │                                                                           │
 * │ This adapter therefore ships the MANIFEST + ISOLATION TESTS only. The     │
 * │ capability set, paths, and auth shape are correct and validated against   │
 * │ stubbed fetch; live execution is gated on a follow-up that teaches the    │
 * │ runtime to present client certs (tracked separately — see the PR).        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Auth is OAuth2; ADP supports both client_credentials (server-to-server Data
 * Connector apps — the natural fit for bulk reads) and authorization_code
 * (delegated End-User apps). We declare the authorization_code shape here so
 * the manifest carries both the authorize and token URLs; the access token is
 * still injected by the platform and sent as `Authorization: Bearer`.
 *
 * Most HR/payroll endpoints also require a `roleCode` header
 * (practitioner|employee|manager|administrator|supervisor); we default it to
 * `practitioner`. SSN/birth-date are masked unless the caller adds
 * `Accept: application/json;masked=false` with a practitioner role + scopes —
 * we leave masking ON by default. The `associateOID` (AOID) is the primary key
 * resolved from worker.list and threaded into every per-worker endpoint.
 *
 * The pay-statement IMAGE endpoint is intentionally excluded — it returns a
 * binary PDF, which the JSON runtime cannot parse.
 */
export const adpConnector = declarativeRestConnector({
  kind: 'adp',
  displayName: 'ADP',
  description:
    'Read HR and payroll data from ADP Workforce Now: workers, worker demographics, pay statements, and pay distributions. Requires mutual-TLS client certificates (see adapter notes) in addition to OAuth2.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.adp.com/auth/oauth/v2/authorize',
    tokenUrl: 'https://accounts.adp.com/auth/oauth/v2/token',
    scopes: [
      'hr/workerInformationManagement/read',
      'payroll/payStatementManagement/read',
    ],
    clientIdEnv: 'ADP_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ADP_OAUTH_CLIENT_SECRET',
  },
  category: 'hr',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.adp.com',
  // ADP requires a roleCode on most HR/payroll endpoints; practitioner is the
  // broadest read role. (PII stays masked unless the caller opts into
  // `Accept: application/json;masked=false`.)
  defaultHeaders: { roleCode: 'practitioner' },
  test: { method: 'GET', path: '/hr/v2/workers/meta' },
  capabilities: [
    {
      name: 'worker.list',
      class: 'read',
      description:
        'Collection of all workers for the authenticated client. OData paging via $top/$skip (default 50, max 100); total at meta.totalNumber. The associateOID on each worker is the key for per-worker endpoints. SSN/birth date are masked.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer', description: 'OData $top page size (default 50, max 100).' },
          skip: { type: 'integer', description: 'OData $skip offset for pagination.' },
          filter: { type: 'string', description: 'OData $filter expression.' },
          select: { type: 'string', description: 'OData $select field projection.' },
        },
      },
      request: {
        method: 'GET',
        path: '/hr/v2/workers',
        query: { $top: '{top}', $skip: '{skip}', $filter: '{filter}', $select: '{select}' },
      },
    },
    {
      name: 'worker.get',
      class: 'read',
      description: 'A single worker by Associate OID (aoid). SSN/birth date are masked unless unmasking is requested.',
      parameters: {
        type: 'object',
        properties: {
          aoid: { type: 'string', description: 'Associate OID from worker.list.' },
          select: { type: 'string', description: 'OData $select field projection.' },
        },
        required: ['aoid'],
      },
      request: {
        method: 'GET',
        path: '/hr/v2/workers/{aoid}',
        query: { $select: '{select}' },
      },
    },
    {
      name: 'worker.demographics.list',
      class: 'read',
      description:
        'Worker collection WITHOUT PII/SPI (no SSN, no full birth date) — a lighter payload than worker.list. OData paging supported.',
      parameters: {
        type: 'object',
        properties: {
          top: { type: 'integer' },
          skip: { type: 'integer' },
          filter: { type: 'string' },
          select: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/hr/v2/worker-demographics',
        query: { $top: '{top}', $skip: '{skip}', $filter: '{filter}', $select: '{select}' },
      },
    },
    {
      name: 'worker.demographics.get',
      class: 'read',
      description: 'Demographic data for one worker by Associate OID, without PII/SPI.',
      parameters: {
        type: 'object',
        properties: {
          aoid: { type: 'string' },
          select: { type: 'string' },
        },
        required: ['aoid'],
      },
      request: {
        method: 'GET',
        path: '/hr/v2/worker-demographics/{aoid}',
        query: { $select: '{select}' },
      },
    },
    {
      name: 'paystatements.list',
      class: 'read',
      description:
        'Pay statements for one worker: payDate, net/gross pay amounts, total hours, and a statement image URI. Use numberoflastpaydates to cap results.',
      parameters: {
        type: 'object',
        properties: {
          aoid: { type: 'string', description: 'Associate OID from worker.list.' },
          numberoflastpaydates: { type: 'integer', description: 'Limit to the N most recent pay dates.' },
        },
        required: ['aoid'],
      },
      request: {
        method: 'GET',
        path: '/payroll/v1/workers/{aoid}/pay-statements',
        query: { numberoflastpaydates: '{numberoflastpaydates}' },
      },
    },
    {
      name: 'paystatements.get',
      class: 'read',
      description:
        'Full detail of one pay statement: pay period, net/gross/YTD amounts, earnings, deductions, and memos. The pay-statement id is resolved from paystatements.list.',
      parameters: {
        type: 'object',
        properties: {
          aoid: { type: 'string' },
          payStatementId: { type: 'string', description: 'Pay statement id from paystatements.list.' },
        },
        required: ['aoid', 'payStatementId'],
      },
      request: { method: 'GET', path: '/payroll/v1/workers/{aoid}/pay-statements/{payStatementId}' },
    },
    {
      name: 'paydistributions.get',
      class: 'read',
      description:
        'Direct-deposit distribution setup for one worker: accounts, routing numbers, distribution amounts, and remaining-balance flags.',
      parameters: {
        type: 'object',
        properties: { aoid: { type: 'string' } },
        required: ['aoid'],
      },
      request: { method: 'GET', path: '/payroll/v2/workers/{aoid}/pay-distributions' },
    },
  ],
})
