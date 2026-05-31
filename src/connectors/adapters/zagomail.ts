import { declarativeRestConnector } from './declarative-rest.js'

export const zagomailConnector = declarativeRestConnector({
  kind: 'zagomail',
  displayName: 'Zagomail',
  description: 'All-in-one email marketing and automation platform for managing subscribers, campaigns, and tags.',
  auth: { kind: 'api-key', hint: 'Zagomail API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zagomail.com/api/v1',
  test: { method: 'GET', path: '/auth/validate' },
  capabilities: [
    {
      name: 'subscribers.create',
      class: 'mutation',
      description: 'Create a new subscriber in Zagomail.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the subscriber' },
          firstName: { type: 'string', description: 'First name of the subscriber' },
          lastName: { type: 'string', description: 'Last name of the subscriber' },
          metadata: { type: 'object', description: 'Additional subscriber metadata' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/subscribers',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.update',
      class: 'mutation',
      description: 'Update an existing subscriber.',
      parameters: {
        type: 'object',
        properties: {
          subscriberUid: { type: 'string', description: 'Unique identifier of the subscriber' },
          email: { type: 'string', description: 'Updated email address' },
          firstName: { type: 'string', description: 'Updated first name' },
          lastName: { type: 'string', description: 'Updated last name' },
          metadata: { type: 'object', description: 'Updated metadata' },
        },
        required: ['subscriberUid'],
      },
      request: {
        method: 'PATCH',
        path: '/subscribers/{subscriberUid}',
        body: {
          email: '{email}',
          firstName: '{firstName}',
          lastName: '{lastName}',
          metadata: '{metadata}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscribers.get',
      class: 'read',
      description: 'Get subscriber details by ID.',
      parameters: {
        type: 'object',
        properties: {
          subscriberUid: { type: 'string', description: 'Unique identifier of the subscriber' },
        },
        required: ['subscriberUid'],
      },
      request: { method: 'GET', path: '/subscribers/{subscriberUid}' },
    },
    {
      name: 'subscribers.search',
      class: 'read',
      description: 'Search subscribers by email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to search for' },
          limit: { type: 'integer', description: 'Maximum number of results' },
          offset: { type: 'integer', description: 'Offset for pagination' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/subscribers/search',
        query: {
          email: '{email}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'subscribers.add-tags',
      class: 'mutation',
      description: 'Add one or more tags to a subscriber.',
      parameters: {
        type: 'object',
        properties: {
          subscriberUid: { type: 'string', description: 'Unique identifier of the subscriber' },
          tags: { type: 'array', description: 'Array of tag names to add', items: { type: 'string' } },
        },
        required: ['subscriberUid', 'tags'],
      },
      request: {
        method: 'POST',
        path: '/subscribers/{subscriberUid}/tags',
        body: {
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tags.create',
      class: 'mutation',
      description: 'Create a new tag in Zagomail.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the tag to create' },
          description: { type: 'string', description: 'Optional description of the tag' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/tags',
        body: {
          name: '{name}',
          description: '{description}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.get',
      class: 'read',
      description: 'Get campaign details by campaign ID.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Unique identifier of the campaign' },
        },
        required: ['campaignId'],
      },
      request: { method: 'GET', path: '/campaigns/{campaignId}' },
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List all campaigns.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Maximum number of results' },
          offset: { type: 'integer', description: 'Offset for pagination' },
          status: { type: 'string', description: 'Filter by campaign status' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/campaigns',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          status: '{status}',
        },
      },
    },
  ],
})
