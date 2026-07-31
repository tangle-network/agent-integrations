import type { ConnectorAdapter } from '../types.js'
import { declarativeRestConnector } from './declarative-rest.js'

const userId = { type: 'string', description: 'SCIM user resource id.' } as const
const groupId = { type: 'string', description: 'SCIM group resource id.' } as const
const patchSchema = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

const scimRestConnector = declarativeRestConnector({
  kind: 'scim',
  displayName: 'SCIM',
  description: 'Provision users, groups, and group memberships against any public SCIM 2.0 service provider.',
  auth: {
    kind: 'api-key',
    hint: 'SCIM bearer token. Set baseUrl to the provider SCIM 2.0 root, for example https://tenant.example.com/scim/v2.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  requirePublicHttpsBaseUrl: true,
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    Accept: 'application/scim+json, application/json',
    'Content-Type': 'application/scim+json',
  },
  test: { method: 'GET', path: '/ServiceProviderConfig' },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List or filter SCIM users with standard pagination and attribute selection.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          startIndex: { type: 'integer', minimum: 1 },
          count: { type: 'integer', minimum: 1, maximum: 1000 },
          attributes: { type: 'string' },
          excludedAttributes: { type: 'string' },
          sortBy: { type: 'string' },
          sortOrder: { type: 'string', enum: ['ascending', 'descending'] },
        },
      },
      request: {
        method: 'GET',
        path: '/Users',
        query: {
          filter: '{filter}', startIndex: '{startIndex}', count: '{count}',
          attributes: '{attributes}', excludedAttributes: '{excludedAttributes}',
          sortBy: '{sortBy}', sortOrder: '{sortOrder}',
        },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read one SCIM user.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: { method: 'GET', path: '/Users/{userId}' },
    },
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a SCIM user from a complete provider-compatible resource.',
      parameters: { type: 'object', properties: { user: { type: 'object' } }, required: ['user'] },
      request: { method: 'POST', path: '/Users', body: '{user}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.replace',
      class: 'mutation',
      description: 'Replace a SCIM user resource.',
      parameters: {
        type: 'object',
        properties: { userId, user: { type: 'object' } },
        required: ['userId', 'user'],
      },
      request: { method: 'PUT', path: '/Users/{userId}', body: '{user}' },
      cas: 'etag-if-match',
      externalEffect: true,
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Apply SCIM PatchOp operations to a user.',
      parameters: {
        type: 'object',
        properties: { userId, operations: { type: 'array', items: { type: 'object' } } },
        required: ['userId', 'operations'],
      },
      request: {
        method: 'PATCH',
        path: '/Users/{userId}',
        body: { schemas: [patchSchema], Operations: '{operations}' },
      },
      cas: 'etag-if-match',
      externalEffect: true,
    },
    {
      name: 'users.deactivate',
      class: 'mutation',
      description: 'Deactivate a SCIM user by setting active=false.',
      parameters: { type: 'object', properties: { userId }, required: ['userId'] },
      request: {
        method: 'PATCH',
        path: '/Users/{userId}',
        body: { schemas: [patchSchema], Operations: [{ op: 'replace', path: 'active', value: false }] },
      },
      cas: 'etag-if-match',
      externalEffect: true,
    },
    {
      name: 'groups.list',
      class: 'read',
      description: 'List or filter SCIM groups.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          startIndex: { type: 'integer', minimum: 1 },
          count: { type: 'integer', minimum: 1, maximum: 1000 },
          attributes: { type: 'string' },
          excludedAttributes: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/Groups',
        query: {
          filter: '{filter}', startIndex: '{startIndex}', count: '{count}',
          attributes: '{attributes}', excludedAttributes: '{excludedAttributes}',
        },
      },
    },
    {
      name: 'groups.get',
      class: 'read',
      description: 'Read one SCIM group.',
      parameters: { type: 'object', properties: { groupId }, required: ['groupId'] },
      request: { method: 'GET', path: '/Groups/{groupId}' },
    },
    {
      name: 'groups.create',
      class: 'mutation',
      description: 'Create a SCIM group from a complete provider-compatible resource.',
      parameters: { type: 'object', properties: { group: { type: 'object' } }, required: ['group'] },
      request: { method: 'POST', path: '/Groups', body: '{group}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'groups.update',
      class: 'mutation',
      description: 'Apply SCIM PatchOp operations to a group.',
      parameters: {
        type: 'object',
        properties: { groupId, operations: { type: 'array', items: { type: 'object' } } },
        required: ['groupId', 'operations'],
      },
      request: {
        method: 'PATCH',
        path: '/Groups/{groupId}',
        body: { schemas: [patchSchema], Operations: '{operations}' },
      },
      cas: 'etag-if-match',
      externalEffect: true,
    },
    {
      name: 'groups.users.add',
      class: 'mutation',
      description: 'Add a user reference to a SCIM group.',
      parameters: {
        type: 'object',
        properties: { groupId, userId },
        required: ['groupId', 'userId'],
      },
      request: {
        method: 'PATCH',
        path: '/Groups/{groupId}',
        body: {
          schemas: [patchSchema],
          Operations: [{ op: 'add', path: 'members', value: [{ value: '{userId}' }] }],
        },
      },
      cas: 'etag-if-match',
      externalEffect: true,
    },
    {
      name: 'groups.users.remove',
      class: 'mutation',
      description: 'Remove a user reference from a SCIM group.',
      parameters: {
        type: 'object',
        properties: {
          groupId,
          userId,
        },
        required: ['groupId', 'userId'],
      },
      request: {
        method: 'PATCH',
        path: '/Groups/{groupId}',
        body: { schemas: [patchSchema], Operations: ['{operation}'] },
      },
      cas: 'etag-if-match',
      externalEffect: true,
    },
  ],
})

export const scimConnector: ConnectorAdapter = {
  ...scimRestConnector,
  async executeMutation(invocation) {
    if (invocation.capabilityName !== 'groups.users.remove') {
      return scimRestConnector.executeMutation!(invocation)
    }
    const userIdValue = invocation.args.userId
    if (typeof userIdValue !== 'string' || !userIdValue.trim()) {
      throw new Error('missing required argument: userId')
    }
    return scimRestConnector.executeMutation!({
      ...invocation,
      args: {
        ...invocation.args,
        operation: {
          op: 'remove',
          path: `members[value eq "${escapeScimFilterValue(userIdValue)}"]`,
        },
      },
    })
  },
}

function escapeScimFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
