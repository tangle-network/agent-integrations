import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Clerk users through the Backend API with a secret key (`sk_live_…`). New
 * signups arrive as `clerk.user.created` webhooks from Svix
 * (`clerkWebhookProvider` in `../../webhooks`); these reads look a user up or
 * list recent signups.
 */
export const clerkConnector = declarativeRestConnector({
  kind: 'clerk',
  displayName: 'Clerk',
  description: 'Read Clerk users and receive signup webhooks.',
  category: 'other',
  auth: { kind: 'api-key', hint: 'Clerk secret key (sk_live_… or sk_test_…) from API keys in the Clerk dashboard.' },
  baseUrl: 'https://api.clerk.com/v1',
  defaultConsistencyModel: 'authoritative',
  test: { method: 'GET', path: '/users?limit=1' },
  capabilities: [
    {
      name: 'users.list',
      class: 'read',
      description: 'List users, newest first by default (`order_by: "-created_at"`).',
      parameters: {
        type: 'object',
        properties: {
          order_by: { type: 'string', description: 'e.g. "-created_at" (newest first) or "created_at".' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
          email_address: { type: 'string', description: 'Only users with this email address.' },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { order_by: '{order_by}', limit: '{limit}', offset: '{offset}', email_address: '{email_address}' },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Read one user by id (user_…).',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string', pattern: '^user_[A-Za-z0-9]+$' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/users/{userId}' },
    },
  ],
})
