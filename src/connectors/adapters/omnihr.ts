import { declarativeRestConnector } from './declarative-rest.js'

// OmniHR is an all-in-one HR platform for employee management, time tracking, and HR workflows.
// Authentication uses username, password, and organization origin (base URL).
// The origin (e.g., https://youraccount.omnihr.com) must be stored in connection metadata.
export const omnihrConnector = declarativeRestConnector({
  kind: 'omnihr',
  displayName: 'Omni HR',
  description:
    'Smart, all-in-one HR platform for managing employees, time tracking, and HR workflows.',
  auth: {
    kind: 'api-key',
    hint: 'OmniHR credentials: username (email), password, and organization origin URL (e.g., https://youraccount.omnihr.com). The connection must store these in metadata.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'origin' },
  test: { method: 'GET', path: '/api/v1/employees/me' },
  capabilities: [
    {
      name: 'employees.get.system.id',
      class: 'read',
      description: 'Get the system ID of an employee by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/employees/system-id',
        query: { email: '{email}' },
      },
    },
    {
      name: 'employees.get.info',
      class: 'read',
      description: 'Retrieve detailed information about an employee.',
      parameters: {
        type: 'object',
        properties: {
          systemId: { type: 'integer' },
        },
        required: ['systemId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/employees/{systemId}',
      },
    },
    {
      name: 'employees.get.organizational.chart',
      class: 'read',
      description:
        'Get the organizational chart structure for an employee, showing reporting relationships.',
      parameters: {
        type: 'object',
        properties: {
          systemId: { type: 'integer' },
        },
        required: ['systemId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/employees/{systemId}/organizational-chart',
      },
    },
    {
      name: 'employees.get.direct.reports',
      class: 'read',
      description: 'Retrieve the list of direct reports for an employee.',
      parameters: {
        type: 'object',
        properties: {
          systemId: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['systemId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/employees/{systemId}/direct-reports',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
  ],
})
