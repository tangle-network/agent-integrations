import type { ConnectorAdapter } from '../types.js'
import { clientCredentialsRestConnector } from './client-credentials-rest.js'

const userId = { type: 'string', description: 'OneLogin user id.' } as const
const groupId = { type: 'string', description: 'OneLogin group id.' } as const

const oneloginRestConnector = clientCredentialsRestConnector({
  kind: 'onelogin',
  displayName: 'OneLogin',
  description: 'Provision OneLogin users, groups, and user group assignments with customer-owned API credentials.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"clientId":"...","clientSecret":"...","region":"us|eu"}.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  regions: {
    us: {
      apiBaseUrl: 'https://api.us.onelogin.com',
      tokenUrl: 'https://api.us.onelogin.com/auth/oauth2/v2/token',
    },
    eu: {
      apiBaseUrl: 'https://api.eu.onelogin.com',
      tokenUrl: 'https://api.eu.onelogin.com/auth/oauth2/v2/token',
    },
  },
  defaultRegion: 'us',
  tokenCredentialPlacement: 'form-body',
  apiCredentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'bearer:' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/api/2/users', query: { limit: 1 } },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List or filter OneLogin users.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          page: { type: 'integer', minimum: 1 },
          email: { type: 'string' },
          username: { type: 'string' },
          status: { type: 'integer' },
          group_id: { type: 'integer' },
          role_id: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/2/users',
        query: {
          limit: '{limit}',
          page: '{page}',
          email: '{email}',
          username: '{username}',
          status: '{status}',
          group_id: '{group_id}',
          role_id: '{role_id}',
        },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read one OneLogin user.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: { method: 'GET', path: '/api/2/users/{userId}' },
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a OneLogin user from a provider-native user object.',
      parameters: { type: 'object', properties: { user: { type: 'object' } }, required: ['user'] },
      request: { method: 'POST', path: '/api/2/users', body: '{user}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Update mutable fields on a OneLogin user.',
      parameters: {
        type: 'object',
        properties: { userId, user: { type: 'object' } },
        required: ['userId', 'user'],
      },
      request: { method: 'PUT', path: '/api/2/users/{userId}', body: '{user}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'users.deactivate',
      class: 'mutation',
      description: 'Set a OneLogin user to suspended status without deleting the record.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: { method: 'PUT', path: '/api/2/users/{userId}', body: { status: 2 } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List OneLogin groups.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          page: { type: 'integer', minimum: 1 },
          name: { type: 'string' },
        },
      },
      request: { method: 'GET', path: '/api/1/groups', query: { limit: '{limit}', page: '{page}', name: '{name}' } },
    },
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read one OneLogin group.',
      parameters: { type: 'object', properties: { groupId }, required: ['groupId'] },
      request: { method: 'GET', path: '/api/1/groups/{groupId}' },
    },
    {
      name: 'groups.users.add',
      class: 'mutation',
      description: 'Assign a OneLogin user to a group. OneLogin permits one group per user.',
      parameters: {
        type: 'object',
        properties: { groupId, userId },
        required: ['groupId', 'userId'],
      },
      request: { method: 'PUT', path: '/api/2/users/{userId}', body: { group_id: '{groupId}' } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'groups.users.remove',
      class: 'mutation',
      description: 'Remove a OneLogin user from the expected current group.',
      parameters: {
        type: 'object',
        properties: { groupId, userId },
        required: ['groupId', 'userId'],
      },
      request: { method: 'PUT', path: '/api/2/users/{userId}', body: { group_id: null } },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})

export const oneloginConnector: ConnectorAdapter = {
  ...oneloginRestConnector,
  async executeMutation(invocation) {
    if (invocation.capabilityName !== 'groups.users.remove') {
      return oneloginRestConnector.executeMutation!(invocation)
    }
    const current = await oneloginRestConnector.executeRead!({
      ...invocation,
      capabilityName: 'users.get',
      args: { userId: invocation.args.userId },
    })
    const currentGroup = readGroupId(current.data)
    const expectedGroup = String(invocation.args.groupId)
    if (currentGroup !== expectedGroup) {
      return {
        status: 'conflict',
        alternatives: [],
        currentState: current.data,
        message: `OneLogin user is assigned to group ${currentGroup ?? 'none'}, not ${expectedGroup}`,
      }
    }
    return oneloginRestConnector.executeMutation!(invocation)
  },
}

function readGroupId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const value = (data as Record<string, unknown>).group_id
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}
