import { declarativeRestConnector } from './declarative-rest.js'

export const kustomerConnector = declarativeRestConnector({
  kind: 'kustomer',
  displayName: 'Kustomer',
  description: 'Create and manage Kustomer customers, conversations, and custom objects.',
  auth: {
    kind: 'api-key',
    hint: 'Kustomer API key from your Kustomer account settings.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.kustomerapp.com',
  test: { method: 'GET', path: '/v1/customers' },
  capabilities: [
    {
      name: 'customers.create',
      class: 'mutation',
      description: 'Create a new Kustomer customer.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Primary email address of the customer.' },
          phone: { type: 'string', description: 'Primary phone number in E.164 format.' },
          firstName: { type: 'string', description: 'First name of the customer.' },
          lastName: { type: 'string', description: 'Last name of the customer.' },
          company: { type: 'string', description: 'Name of the company the customer belongs to.' },
          username: { type: 'string', description: 'Username or handle for the customer.' },
          locale: { type: 'string', description: 'Language/locale code (e.g. en, es).' },
          timeZone: { type: 'string', description: 'IANA timezone identifier.' },
          gender: { type: 'string', description: 'Gender (male, female, other).' },
          birthdayAt: { type: 'string', description: 'Customer birthday in ISO 8601 format.' },
          signedUpAt: { type: 'string', description: 'When customer registered in ISO 8601 format.' },
          avatarUrl: { type: 'string', description: 'URL of the customer profile picture.' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/v1/customers',
        body: {
          customer: {
            email: '{email}',
            phone: '{phone}',
            firstName: '{firstName}',
            lastName: '{lastName}',
            company: '{company}',
            username: '{username}',
            locale: '{locale}',
            timeZone: '{timeZone}',
            gender: '{gender}',
            birthdayAt: '{birthdayAt}',
            signedUpAt: '{signedUpAt}',
            avatarUrl: '{avatarUrl}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'customers.get',
      class: 'read',
      description: 'Retrieve a Kustomer customer by ID.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The Kustomer customer ID.' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'GET',
        path: '/v1/customers/{customerId}',
      },
    },
    {
      name: 'customers.update',
      class: 'mutation',
      description: 'Update fields on an existing Kustomer customer.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The Kustomer customer ID.' },
          email: { type: 'string' },
          phone: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          company: { type: 'string' },
          locale: { type: 'string' },
          timeZone: { type: 'string' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'PUT',
        path: '/v1/customers/{customerId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'customers.delete',
      class: 'mutation',
      description: 'Delete a Kustomer customer by ID. Destructive — agent must surface confirmation.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The Kustomer customer ID to delete.' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'DELETE',
        path: '/v1/customers/{customerId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'customers.search',
      class: 'read',
      description: 'Search for Kustomer customers.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Filter by email address.' },
          phone: { type: 'string', description: 'Filter by phone number.' },
          limit: { type: 'integer', description: 'Maximum number of results (default 10, max 100).' },
          offset: { type: 'integer', description: 'Pagination offset (default 0).' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/customers',
        query: { email: '{email}', phone: '{phone}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'conversations.create',
      class: 'mutation',
      description: 'Create a new Kustomer conversation.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The Kustomer ID of the customer this conversation belongs to.' },
          name: { type: 'string', description: 'A short subject or title for the conversation (max 256 characters).' },
          status: { type: 'string', description: 'The initial status of the conversation (e.g. open, pending, closed).' },
          priority: { type: 'integer', description: 'Conversation priority from 1 (lowest) to 5 (highest).' },
          direction: { type: 'string', description: 'Direction (inbound, outbound).' },
          externalId: { type: 'string', description: 'A unique identifier from your own system (max 256 characters).' },
          replyChannel: { type: 'string', description: 'The channel used to reply (e.g. email, sms, web).' },
        },
        required: ['customerId'],
      },
      request: {
        method: 'POST',
        path: '/v1/conversations',
        body: {
          conversation: {
            customerId: '{customerId}',
            name: '{name}',
            status: '{status}',
            priority: '{priority}',
            direction: '{direction}',
            externalId: '{externalId}',
            replyChannel: '{replyChannel}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'conversations.get',
      class: 'read',
      description: 'Retrieve a Kustomer conversation by ID.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The Kustomer ID of the conversation.' },
        },
        required: ['conversationId'],
      },
      request: {
        method: 'GET',
        path: '/v1/conversations/{conversationId}',
      },
    },
    {
      name: 'conversations.update',
      class: 'mutation',
      description: 'Update a Kustomer conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The Kustomer ID of the conversation to update.' },
          name: { type: 'string', description: 'Conversation subject or title.' },
          status: { type: 'string', description: 'Conversation status.' },
          priority: { type: 'integer', description: 'Conversation priority from 1 to 5.' },
        },
        required: ['conversationId'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/conversations/{conversationId}',
        body: {
          conversation: {
            name: '{name}',
            status: '{status}',
            priority: '{priority}',
          },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'conversations.close',
      class: 'mutation',
      description: 'Close a Kustomer conversation by setting its status to "done".',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'The Kustomer ID of the conversation to close.' },
        },
        required: ['conversationId'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/conversations/{conversationId}',
        body: {
          conversation: {
            status: 'done',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'customObjects.get',
      class: 'read',
      description: 'Retrieve custom objects of a specific class.',
      parameters: {
        type: 'object',
        properties: {
          klassName: { type: 'string', description: 'The API name of the custom object class (e.g. MyCustomClass).' },
          fromDate: { type: 'string', description: 'Filter by creation/update date (ISO 8601 format, e.g. 2024-01-01).' },
          limit: { type: 'integer', description: 'Maximum number of results (default 10, max 100).' },
          offset: { type: 'integer', description: 'Pagination offset (default 0).' },
        },
        required: ['klassName'],
      },
      request: {
        method: 'GET',
        path: '/v1/custom-objects/{klassName}',
        query: { fromDate: '{fromDate}', limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'customObjects.create',
      class: 'mutation',
      description: 'Create a new custom object.',
      parameters: {
        type: 'object',
        properties: {
          klassName: { type: 'string', description: 'The API name of the custom object class.' },
          customerId: { type: 'string', description: 'Associated customer ID if applicable.' },
          data: { type: 'object', description: 'Custom object attributes and values.' },
        },
        required: ['klassName', 'data'],
      },
      request: {
        method: 'POST',
        path: '/v1/custom-objects/{klassName}',
        body: {
          customObject: {
            customerId: '{customerId}',
            data: '{data}',
          },
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
