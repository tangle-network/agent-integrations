import { declarativeRestConnector } from './declarative-rest.js'

/** Adobe Acrobat Sign REST API v6. The OAuth grant's base-URI discovery
 * response should be persisted as metadata.apiAccessPoint for non-NA1
 * accounts; the fallback targets Adobe's free developer sandbox region. */
export const adobeSignConnector = declarativeRestConnector({
  kind: 'adobe-sign',
  displayName: 'Adobe Acrobat Sign',
  description:
    'Create, send, inspect, cancel, and remind on Adobe Acrobat Sign agreements, with library-document and webhook management.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://secure.na1.adobesign.com/public/oauth/v2',
    tokenUrl: 'https://api.na1.adobesign.com/oauth/v2/token',
    scopes: [
      'user_read:self',
      'agreement_read:account',
      'agreement_write:account',
      'agreement_send:account',
      'library_read:account',
      'webhook_read:account',
      'webhook_write:account',
    ],
    clientIdEnv: 'ADOBE_SIGN_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ADOBE_SIGN_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: {
    metadataKey: 'apiAccessPoint',
    fallback: 'https://api.na1.adobesign.com/api/rest/v6',
  },
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'agreements.list',
      class: 'read',
      description: 'List agreements visible to the authenticated Acrobat Sign account.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
          query: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/agreements',
        query: { pageSize: '{pageSize}', cursor: '{cursor}', query: '{query}' },
      },
      requiredScopes: ['agreement_read:account'],
    },
    {
      name: 'agreements.get',
      class: 'read',
      description: 'Read an agreement and its current signature status.',
      parameters: {
        type: 'object',
        properties: { agreementId: { type: 'string' } },
        required: ['agreementId'],
      },
      request: { method: 'GET', path: '/agreements/{agreementId}' },
      requiredScopes: ['agreement_read:account'],
    },
    {
      name: 'agreements.create',
      class: 'mutation',
      description:
        'Create and optionally send an agreement. The request body follows Adobe Sign v6 (fileInfos, participantSetsInfo, name, signatureType, state).',
      parameters: {
        type: 'object',
        properties: {
          fileInfos: { type: 'array', items: { type: 'object' } },
          participantSetsInfo: { type: 'array', items: { type: 'object' } },
          name: { type: 'string' },
          signatureType: { type: 'string', enum: ['ESIGN', 'WRITTEN'] },
          state: { type: 'string', enum: ['DRAFT', 'AUTHORING', 'IN_PROCESS'] },
          message: { type: 'string' },
          expirationTime: { type: 'string' },
        },
        required: ['fileInfos', 'participantSetsInfo', 'name', 'signatureType', 'state'],
      },
      request: { method: 'POST', path: '/agreements', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['agreement_write:account', 'agreement_send:account'],
    },
    {
      name: 'agreements.cancel',
      class: 'mutation',
      description: 'Cancel an in-progress agreement and record an optional comment.',
      parameters: {
        type: 'object',
        properties: {
          agreementId: { type: 'string' },
          comment: { type: 'string' },
          notifySigner: { type: 'boolean' },
        },
        required: ['agreementId'],
      },
      request: {
        method: 'PUT',
        path: '/agreements/{agreementId}/state',
        body: { state: 'CANCELLED', comment: '{comment}', notifySigner: '{notifySigner}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['agreement_write:account'],
    },
    {
      name: 'agreements.remind',
      class: 'mutation',
      description: 'Send an immediate reminder to pending agreement participants.',
      parameters: {
        type: 'object',
        properties: {
          agreementId: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['agreementId'],
      },
      request: {
        method: 'POST',
        path: '/agreements/{agreementId}/reminders',
        body: { status: 'ACTIVE', note: '{note}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['agreement_write:account'],
    },
    {
      name: 'libraryDocuments.list',
      class: 'read',
      description: 'List reusable Acrobat Sign library documents and templates.',
      parameters: {
        type: 'object',
        properties: { pageSize: { type: 'integer' }, cursor: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/libraryDocuments',
        query: { pageSize: '{pageSize}', cursor: '{cursor}' },
      },
      requiredScopes: ['library_read:account'],
    },
    {
      name: 'webhooks.list',
      class: 'read',
      description: 'List Acrobat Sign webhook subscriptions.',
      parameters: {
        type: 'object',
        properties: { pageSize: { type: 'integer' }, cursor: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/webhooks',
        query: { pageSize: '{pageSize}', cursor: '{cursor}' },
      },
      requiredScopes: ['webhook_read:account'],
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description: 'Create an Acrobat Sign webhook subscription.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          scope: { type: 'string' },
          state: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          webhookSubscriptionEvents: { type: 'array', items: { type: 'string' } },
          webhookUrlInfo: { type: 'object' },
          applicationDisplayName: { type: 'string' },
        },
        required: ['name', 'scope', 'state', 'webhookSubscriptionEvents', 'webhookUrlInfo'],
      },
      request: { method: 'POST', path: '/webhooks', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['webhook_write:account'],
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Delete an Acrobat Sign webhook subscription.',
      parameters: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
      request: { method: 'DELETE', path: '/webhooks/{webhookId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['webhook_write:account'],
    },
  ],
})
