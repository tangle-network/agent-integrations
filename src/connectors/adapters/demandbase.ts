import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Demandbase ABM / account-intelligence platform API.
 *
 * Demandbase's platform API authenticates with a machine-to-machine OAuth2
 * `client_credentials` grant: the hub POSTs the API Key Set's client id +
 * secret to https://uapi.demandbase.com/auth/v1/token and receives a JWT
 * bearer token (no interactive authorize step). The manifest therefore sets
 * `grantType: 'client_credentials'` and omits `authorizationUrl`, mirroring
 * the Paychex adapter. Demandbase does not use per-request OAuth scopes —
 * access is governed by which APIs the API Key Set is granted in the UI — so
 * `scopes` is empty.
 *
 * This v1 surface is intentionally conservative: it exposes the Admin user
 * endpoints, which were confirmed against developer.demandbase.com. Note the
 * Demandbase Admin API is asymmetric — the LIST endpoint is plural
 * (`/admin/v1/users`) while single-record GET/POST are singular
 * (`/admin/v1/user`). The broader B2B intent / data-export surface is left
 * for a follow-up once its endpoint shapes are verified.
 */
export const demandbaseConnector = declarativeRestConnector({
  kind: 'demandbase',
  displayName: 'Demandbase',
  description: 'Manage Demandbase platform users (list, get, create) through the Admin API using client-credentials auth.',
  auth: {
    kind: 'oauth2',
    grantType: 'client_credentials',
    tokenUrl: 'https://uapi.demandbase.com/auth/v1/token',
    scopes: [],
    clientIdEnv: 'DEMANDBASE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DEMANDBASE_OAUTH_CLIENT_SECRET',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://uapi.demandbase.com',
  test: { method: 'GET', path: '/admin/v1/users', query: { limit: '1' } },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List platform users. Paginate with limit/offset; filter by status/role.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max records to return (max 100).' },
          offset: { type: 'number', description: 'Pagination offset.' },
          status: { type: 'string', description: 'Filter by user status.' },
          role: { type: 'string', description: 'Filter by user role.' },
        },
      },
      request: {
        method: 'GET',
        path: '/admin/v1/users',
        query: { limit: '{limit}', offset: '{offset}', status: '{status}', role: '{role}' },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Get a single platform user by id.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string', description: "The user's unique identifier." } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/admin/v1/user/{userId}' },
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a platform user. email, first_name, last_name, and role are required.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'User email address.' },
          first_name: { type: 'string', description: 'User first name.' },
          last_name: { type: 'string', description: 'User last name.' },
          role: { type: 'string', description: 'User role within the platform.' },
        },
        required: ['email', 'first_name', 'last_name', 'role'],
      },
      request: { method: 'POST', path: '/admin/v1/user', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
