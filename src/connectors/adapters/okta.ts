import { declarativeRestConnector } from './declarative-rest.js'

const userId = {
  type: 'string',
  description: 'Okta user id or login. Email addresses are accepted as logins.',
} as const

const groupId = { type: 'string', description: 'Okta group id.' } as const

export const oktaConnector = declarativeRestConnector({
  kind: 'okta',
  displayName: 'Okta',
  description: 'Manage Okta users, lifecycle state, groups, memberships, and system-log events.',
  auth: {
    kind: 'api-key',
    hint: 'Okta API token. Set domain to the full HTTPS URL of the Okta organization.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'domain' },
  allowedBaseUrlSuffixes: [
    '.okta.com',
    '.okta-emea.com',
    '.oktapreview.com',
    '.okta-gov.com',
  ],
  requirePublicHttpsBaseUrl: true,
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'SSWS ' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/api/v1/users', query: { limit: 1 } },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List or search users in the Okta organization.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200 },
          after: { type: 'string' },
          search: { type: 'string', description: 'Okta Users API search expression.' },
          filter: { type: 'string', description: 'Okta Users API filter expression.' },
          q: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/users',
        query: {
          limit: '{limit}',
          after: '{after}',
          search: '{search}',
          filter: '{filter}',
          q: '{q}',
        },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read one user by id or login.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: { method: 'GET', path: '/api/v1/users/{userId}' },
    },
    {
      name: 'users.find-by-email',
      class: 'read',
      description: 'Read a user whose Okta login is the supplied email address.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email'],
      },
      request: { method: 'GET', path: '/api/v1/users/{email}' },
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List or search Okta groups.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          filter: { type: 'string' },
          after: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 10_000 },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/groups',
        query: { q: '{q}', filter: '{filter}', after: '{after}', limit: '{limit}' },
      },
    },
    {
      name: 'groups.users.list',
      class: 'read',
      description: 'List users assigned to one Okta group.',
      parameters: { type: 'object', properties: { groupId }, required: ['groupId'] },
      request: { method: 'GET', path: '/api/v1/groups/{groupId}/users' },
    },
    {
      name: 'system.logs.list',
      class: 'read',
      description: 'Read Okta System Log events for audit and synchronization.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO 8601 lower timestamp bound.' },
          until: { type: 'string', description: 'ISO 8601 upper timestamp bound.' },
          filter: { type: 'string' },
          q: { type: 'string' },
          after: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1_000 },
          sortOrder: { type: 'string', enum: ['ASCENDING', 'DESCENDING'] },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/logs',
        query: {
          since: '{since}',
          until: '{until}',
          filter: '{filter}',
          q: '{q}',
          after: '{after}',
          limit: '{limit}',
          sortOrder: '{sortOrder}',
        },
      },
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create an Okta user from a provider-native profile object.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'object', description: 'Okta user profile. login and email are required by Okta.' },
          activate: { type: 'boolean' },
        },
        required: ['profile'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/users',
        query: { activate: '{activate}' },
        body: { profile: '{profile}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Update an Okta user profile.',
      parameters: {
        type: 'object',
        properties: { userId, profile: { type: 'object' } },
        required: ['userId', 'profile'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/users/{userId}',
        body: { profile: '{profile}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    ...lifecycleCapabilities(),
    {
      name: 'groups.create',
      class: 'mutation',
      description: 'Create an Okta group.',
      parameters: {
        type: 'object',
        properties: { profile: { type: 'object', description: 'Group profile containing at least name.' } },
        required: ['profile'],
      },
      request: { method: 'POST', path: '/api/v1/groups', body: { profile: '{profile}' } },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'groups.update',
      class: 'mutation',
      description: 'Update an Okta group profile.',
      parameters: {
        type: 'object',
        properties: { groupId, profile: { type: 'object' } },
        required: ['groupId', 'profile'],
      },
      request: {
        method: 'PUT',
        path: '/api/v1/groups/{groupId}',
        body: { profile: '{profile}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    membershipCapability('groups.users.add', 'PUT', 'Add a user to an Okta group.'),
    membershipCapability('groups.users.remove', 'DELETE', 'Remove a user from an Okta group.'),
  ],
})

function lifecycleCapabilities() {
  return [
    lifecycleCapability('users.activate', 'activate', 'Activate an Okta user.', true),
    lifecycleCapability('users.deactivate', 'deactivate', 'Deactivate an Okta user.', true),
    lifecycleCapability('users.suspend', 'suspend', 'Suspend an Okta user.'),
    lifecycleCapability('users.unsuspend', 'unsuspend', 'Unsuspend an Okta user.'),
  ]
}

function lifecycleCapability(
  name: string,
  operation: string,
  description: string,
  supportsEmail = false,
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object' as const,
      properties: { userId, ...(supportsEmail ? { sendEmail: { type: 'boolean' as const } } : {}) },
      required: ['userId'],
    },
    request: {
      method: 'POST' as const,
      path: `/api/v1/users/{userId}/lifecycle/${operation}`,
      body: {},
      ...(supportsEmail ? { query: { sendEmail: '{sendEmail}' } } : {}),
    },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}

function membershipCapability(
  name: string,
  method: 'PUT' | 'DELETE',
  description: string,
) {
  return {
    name,
    class: 'mutation' as const,
    description,
    parameters: {
      type: 'object' as const,
      properties: { groupId, userId },
      required: ['groupId', 'userId'],
    },
    request: { method, path: '/api/v1/groups/{groupId}/users/{userId}', body: {} },
    cas: 'native-idempotency' as const,
    externalEffect: true,
  }
}
