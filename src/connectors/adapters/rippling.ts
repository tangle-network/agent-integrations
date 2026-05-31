import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Rippling Platform API connector.
 *
 * Rippling exposes a single workforce platform API at api.rippling.com that
 * covers HRIS (employees, groups, departments, work locations), payroll
 * reads, time-and-attendance, and the company directory. Access is granted
 * by an admin installing a Rippling Marketplace app into their company; the
 * resulting OAuth flow yields a workspace-scoped bearer token.
 *
 * OAuth (authorization-code, install-app shape):
 *   - Authorize:  https://app.rippling.com/apps/{client_id}/install
 *                 (the standard authorize/redirect endpoint Rippling publishes
 *                  for marketplace apps; the client_id appears in the path
 *                  rather than the query string, which is consistent with
 *                  Rippling's documented install flow.)
 *   - Token:      https://app.rippling.com/api/o/token/
 *   - Refresh:    same token endpoint with grant_type=refresh_token
 *
 * Scopes:
 *   Rippling uses the OAuth2 scope value `company:read` for the canonical
 *   read surface and per-resource read/write scopes (employees:read, etc.)
 *   for richer mutations. The default set below covers everything the
 *   capabilities map exercises.
 *
 * Base URL: https://api.rippling.com (single global host; no tenant routing).
 *
 * Docs:
 *   - https://developer.rippling.com/docs/rippling-api/getting-started
 *   - https://developer.rippling.com/docs/rippling-api/authentication
 *   - https://developer.rippling.com/docs/rippling-api/api-reference
 */
export const ripplingConnector = declarativeRestConnector({
  kind: 'rippling',
  displayName: 'Rippling',
  description:
    'Read Rippling HRIS data (employees, groups, departments, work locations) and update employee records via the Rippling Platform API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.rippling.com/apps/{client_id}/install',
    tokenUrl: 'https://app.rippling.com/api/o/token/',
    scopes: [
      'company:read',
      'employees:read',
      'employees:write',
      'groups:read',
      'departments:read',
      'work_locations:read',
      'teams:read',
      'company_activity:read',
    ],
    clientIdEnv: 'RIPPLING_OAUTH_CLIENT_ID',
    clientSecretEnv: 'RIPPLING_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.rippling.com',
  test: { method: 'GET', path: '/platform/api/me' },
  capabilities: [
    {
      name: 'company.get',
      class: 'read',
      description: 'Read the installing company record (name, primary work location, currency, identifiers).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/platform/api/companies' },
      requiredScopes: ['company:read'],
    },
    {
      name: 'me.get',
      class: 'read',
      description: 'Read the authenticated installer account (used as a health check and to discover the company id).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/platform/api/me' },
      requiredScopes: ['company:read'],
    },
    {
      name: 'employees.list',
      class: 'read',
      description: 'List employees with optional pagination and status filtering (ACTIVE, TERMINATED, etc.).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
          status: { type: 'string', enum: ['ACTIVE', 'TERMINATED', 'HIRED'] },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/employees',
        query: { limit: '{limit}', offset: '{offset}', status: '{status}' },
      },
      requiredScopes: ['employees:read'],
    },
    {
      name: 'employees.get',
      class: 'read',
      description: 'Read a single employee record by Rippling employee id.',
      parameters: {
        type: 'object',
        properties: { employeeId: { type: 'string' } },
        required: ['employeeId'],
      },
      request: { method: 'GET', path: '/platform/api/employees/{employeeId}' },
      requiredScopes: ['employees:read'],
    },
    {
      name: 'employees.update',
      class: 'mutation',
      description:
        'Update mutable fields on an employee (work email, personal email, phone, title, department, manager, etc.). Only fields included in the body are changed.',
      parameters: {
        type: 'object',
        properties: {
          employeeId: { type: 'string' },
          workEmail: { type: 'string' },
          personalEmail: { type: 'string' },
          phoneNumber: { type: 'string' },
          title: { type: 'string' },
          department: { type: 'string' },
          manager: { type: 'string' },
          workLocation: { type: 'string' },
          customFields: { type: 'object' },
        },
        required: ['employeeId'],
      },
      request: {
        method: 'PATCH',
        path: '/platform/api/employees/{employeeId}',
        body: {
          workEmail: '{workEmail}',
          personalEmail: '{personalEmail}',
          phoneNumber: '{phoneNumber}',
          title: '{title}',
          department: '{department}',
          manager: '{manager}',
          workLocation: '{workLocation}',
          customFields: '{customFields}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['employees:write'],
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List company groups (used by Rippling to model role/permission sets and provisioning targets).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/groups',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['groups:read'],
    },
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read a single group by id, including its current member set.',
      parameters: {
        type: 'object',
        properties: { groupId: { type: 'string' } },
        required: ['groupId'],
      },
      request: { method: 'GET', path: '/platform/api/groups/{groupId}' },
      requiredScopes: ['groups:read'],
    },
    {
      name: 'departments.list',
      class: 'read',
      description: 'List the company departments (parent of employee.department references).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/departments',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['departments:read'],
    },
    {
      name: 'departments.get',
      class: 'read',
      description: 'Read a single department by id.',
      parameters: {
        type: 'object',
        properties: { departmentId: { type: 'string' } },
        required: ['departmentId'],
      },
      request: { method: 'GET', path: '/platform/api/departments/{departmentId}' },
      requiredScopes: ['departments:read'],
    },
    {
      name: 'work_locations.list',
      class: 'read',
      description: 'List the company work locations (used for employee.workLocation references).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/work_locations',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['work_locations:read'],
    },
    {
      name: 'work_locations.get',
      class: 'read',
      description: 'Read a single work location by id.',
      parameters: {
        type: 'object',
        properties: { workLocationId: { type: 'string' } },
        required: ['workLocationId'],
      },
      request: { method: 'GET', path: '/platform/api/work_locations/{workLocationId}' },
      requiredScopes: ['work_locations:read'],
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'List the company teams (reporting/working groups distinct from departments).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/teams',
        query: { limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['teams:read'],
    },
    {
      name: 'company_activity.list',
      class: 'read',
      description:
        'List company activity events (hires, terminations, role changes, etc.) optionally bounded by start/end timestamps.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'ISO-8601 timestamp lower bound.' },
          endDate: { type: 'string', description: 'ISO-8601 timestamp upper bound.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
        },
      },
      request: {
        method: 'GET',
        path: '/platform/api/company_activity',
        query: {
          startDate: '{startDate}',
          endDate: '{endDate}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
      requiredScopes: ['company_activity:read'],
    },
  ],
})
