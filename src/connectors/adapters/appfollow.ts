import { declarativeRestConnector } from './declarative-rest.js'

export const appfollowConnector = declarativeRestConnector({
  kind: 'appfollow',
  displayName: 'AppFollow',
  description: 'Manage and improve app reviews and ratings via AppFollow.',
  auth: { kind: 'api-key', hint: 'AppFollow API key (sent as Bearer token).' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.appfollow.io',
  credentialPlacement: { kind: 'bearer' },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'reply.to.review',
      class: 'mutation',
      description: 'Reply to an app store review.',
      parameters: {
        type: 'object',
        properties: {
          ext_id: { type: 'string', description: 'Application external id in AppFollow.' },
          review_id: { type: 'string', description: 'Review id to reply to.' },
          fromDate: { type: 'string', description: 'Start date for the reviews to reply to (YYYY-MM-DD).' },
          toDate: { type: 'string', description: 'End date for the reviews to reply to (YYYY-MM-DD).' },
          answer_text: { type: 'string', description: 'Text of the reply to the review.' },
        },
        required: ['ext_id', 'review_id', 'fromDate', 'answer_text'],
      },
      request: {
        method: 'POST',
        path: '/reviews/reply',
        body: {
          ext_id: '{ext_id}',
          review_id: '{review_id}',
          from: '{fromDate}',
          to: '{toDate}',
          answer_text: '{answer_text}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'add.user',
      class: 'mutation',
      description: 'Add a user to the AppFollow workspace.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the user to be added.' },
          email: { type: 'string', description: 'Email of the user to be added.' },
          role: { type: 'string', description: 'Role of the user to be added.' },
        },
        required: ['name', 'email', 'role'],
      },
      request: {
        method: 'POST',
        path: '/users',
        body: {
          name: '{name}',
          email: '{email}',
          role: '{role}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'reviews.list',
      class: 'read',
      description: 'List reviews for an application within a date range (powers the new.review trigger).',
      parameters: {
        type: 'object',
        properties: {
          ext_id: { type: 'string', description: 'Application external id in AppFollow.' },
          from: { type: 'string', description: 'Start date (YYYY-MM-DD).' },
          to: { type: 'string', description: 'End date (YYYY-MM-DD).' },
          page: { type: 'integer' },
        },
        required: ['ext_id'],
      },
      request: {
        method: 'GET',
        path: '/reviews',
        query: { ext_id: '{ext_id}', from: '{from}', to: '{to}', page: '{page}' },
      },
    },
    {
      name: 'tags.list',
      class: 'read',
      description: 'List review tags for an application (powers the new.tag trigger).',
      parameters: {
        type: 'object',
        properties: {
          ext_id: { type: 'string', description: 'Application external id in AppFollow.' },
        },
        required: ['ext_id'],
      },
      request: {
        method: 'GET',
        path: '/tags',
        query: { ext_id: '{ext_id}' },
      },
    },
  ],
})
