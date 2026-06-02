import { declarativeRestConnector } from './declarative-rest.js'

export const videoaskConnector = declarativeRestConnector({
  kind: 'videoask',
  displayName: 'VideoAsk',
  description: 'Manage VideoAsk forms, contacts, and responses. Create or update contacts, add/remove tags, and search forms.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.videoask.com/oauth/authorize',
    tokenUrl: 'https://www.videoask.com/oauth/token',
    scopes: ['contacts:write', 'contacts:read', 'forms:read'],
    clientIdEnv: 'VIDEOASK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'VIDEOASK_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.videoask.com/v2',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'contacts.create',
      class: 'mutation',
      description: 'Create a new contact in VideoAsk.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
          customFields: { type: 'object' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/contacts',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          phone: '{phone}',
          customFields: '{customFields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.update',
      class: 'mutation',
      description: 'Update an existing contact in VideoAsk.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
          customFields: { type: 'object' },
        },
        required: ['contactId'],
      },
      request: {
        method: 'PATCH',
        path: '/contacts/{contactId}',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          phone: '{phone}',
          customFields: '{customFields}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'contacts.tags.add',
      class: 'mutation',
      description: 'Add a tag to a contact in VideoAsk.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['contactId', 'tag'],
      },
      request: {
        method: 'POST',
        path: '/contacts/{contactId}/tags',
        body: { tag: '{tag}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.tags.remove',
      class: 'mutation',
      description: 'Remove a tag from a contact in VideoAsk.',
      parameters: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['contactId', 'tag'],
      },
      request: {
        method: 'DELETE',
        path: '/contacts/{contactId}/tags/{tag}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'forms.search',
      class: 'read',
      description: 'Search and list VideoAsk forms.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/forms',
        query: {
          search: '{search}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'forms.get',
      class: 'read',
      description: 'Get details of a specific form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formId}',
      },
    },
    {
      name: 'responses.list',
      class: 'read',
      description: 'List responses for a form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formId}/responses',
        query: {
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'forms.create',
      class: 'mutation',
      description: 'Create a new VideoAsk form.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          settings: { type: 'object' },
        },
        required: ['title'],
      },
      request: {
        method: 'POST',
        path: '/forms',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'forms.update',
      class: 'mutation',
      description: 'Update form configuration.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          settings: { type: 'object' },
        },
        required: ['formId'],
      },
      request: {
        method: 'PATCH',
        path: '/forms/{formId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'forms.delete',
      class: 'mutation',
      description: 'Delete a form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
        },
        required: ['formId'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{formId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'responses.delete',
      class: 'mutation',
      description: 'Delete a response.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          responseId: { type: 'string' },
        },
        required: ['formId', 'responseId'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{formId}/responses/{responseId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
