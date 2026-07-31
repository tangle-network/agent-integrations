import { clientCredentialsRestConnector } from './client-credentials-rest.js'

const userId = { type: 'string', description: 'PingOne user id.' } as const
const groupId = { type: 'string', description: 'PingOne group id.' } as const

const regions = {
  us: { apiBaseUrl: 'https://api.pingone.com', tokenUrl: 'https://auth.pingone.com/{connection.environmentId}/as/token' },
  ca: { apiBaseUrl: 'https://api.pingone.ca', tokenUrl: 'https://auth.pingone.ca/{connection.environmentId}/as/token' },
  eu: { apiBaseUrl: 'https://api.pingone.eu', tokenUrl: 'https://auth.pingone.eu/{connection.environmentId}/as/token' },
  au: { apiBaseUrl: 'https://api.pingone.com.au', tokenUrl: 'https://auth.pingone.com.au/{connection.environmentId}/as/token' },
  asia: { apiBaseUrl: 'https://api.pingone.asia', tokenUrl: 'https://auth.pingone.asia/{connection.environmentId}/as/token' },
} as const

export const pingIdentityConnector = clientCredentialsRestConnector({
  kind: 'ping-identity',
  displayName: 'Ping Identity',
  description: 'Provision PingOne users, groups, and group memberships with customer-owned worker credentials.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"clientId":"...","clientSecret":"...","region":"us|ca|eu|au|asia"}. Set environmentId in connection metadata.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  regions,
  defaultRegion: 'us',
  defaultHeaders: { Accept: 'application/json' },
  test: {
    method: 'GET',
    path: '/v1/environments/{connection.environmentId}/users',
    query: { limit: 1 },
  },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List or filter users in the connected PingOne environment.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          filter: { type: 'string' },
          order: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/environments/{connection.environmentId}/users',
        query: { limit: '{limit}', filter: '{filter}', order: '{order}' },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read one PingOne user.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: { method: 'GET', path: '/v1/environments/{connection.environmentId}/users/{userId}' },
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a PingOne user from a provider-native user object.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'object' } },
        required: ['user'],
      },
      request: { method: 'POST', path: '/v1/environments/{connection.environmentId}/users', body: '{user}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Patch mutable fields on a PingOne user.',
      parameters: {
        type: 'object',
        properties: { userId, user: { type: 'object' } },
        required: ['userId', 'user'],
      },
      request: { method: 'PATCH', path: '/v1/environments/{connection.environmentId}/users/{userId}', body: '{user}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'users.deactivate',
      class: 'mutation',
      description: 'Disable a PingOne user without deleting the record.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: {
        method: 'PATCH',
        path: '/v1/environments/{connection.environmentId}/users/{userId}',
        body: { enabled: false },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List or filter groups in the PingOne environment.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          filter: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/environments/{connection.environmentId}/groups',
        query: { limit: '{limit}', filter: '{filter}' },
      },
    },
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read one PingOne group.',
      parameters: { type: 'object', properties: { groupId }, required: ['groupId'] },
      request: { method: 'GET', path: '/v1/environments/{connection.environmentId}/groups/{groupId}' },
    },
    {
      name: 'groups.create',
      class: 'mutation',
      description: 'Create a PingOne group from a provider-native group object.',
      parameters: { type: 'object', properties: { group: { type: 'object' } }, required: ['group'] },
      request: { method: 'POST', path: '/v1/environments/{connection.environmentId}/groups', body: '{group}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'groups.update',
      class: 'mutation',
      description: 'Patch mutable fields on a PingOne group.',
      parameters: {
        type: 'object',
        properties: { groupId, group: { type: 'object' } },
        required: ['groupId', 'group'],
      },
      request: { method: 'PUT', path: '/v1/environments/{connection.environmentId}/groups/{groupId}', body: '{group}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'groups.users.add',
      class: 'mutation',
      description: 'Add a PingOne user to a group.',
      parameters: {
        type: 'object',
        properties: { groupId, userId },
        required: ['groupId', 'userId'],
      },
      request: {
        method: 'POST',
        path: '/v1/environments/{connection.environmentId}/users/{userId}/memberOfGroups',
        body: { id: '{groupId}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'groups.users.remove',
      class: 'mutation',
      description: 'Remove a PingOne user from a group.',
      parameters: {
        type: 'object',
        properties: { groupId, userId },
        required: ['groupId', 'userId'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/environments/{connection.environmentId}/users/{userId}/memberOfGroups/{groupId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
