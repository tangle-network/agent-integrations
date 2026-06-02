import { declarativeRestConnector } from './declarative-rest.js'

export const uscreenConnector = declarativeRestConnector({
  kind: 'uscreen',
  displayName: 'Uscreen',
  description: 'Create users, assign access, and manage video monetization content.',
  auth: { kind: 'api-key', hint: 'Uscreen API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.uscreen.tv/v1',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'users.create',
      class: 'mutation',
      description: 'Create a new user in Uscreen.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'The new user email address.' },
          first_name: { type: 'string', description: 'The new user first name.' },
          last_name: { type: 'string', description: 'The new user last name.' },
          password: { type: 'string', description: 'The new user password.' },
          opted_in_for_news_and_updates: { type: 'boolean', description: 'Whether the user opted in for news and updates.' },
          custom_fields: { type: 'object', description: 'Custom fields defined in your storefront.' },
        },
        required: ['email', 'first_name', 'last_name'],
      },
      request: {
        method: 'POST',
        path: '/users',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          password: '{password}',
          opted_in_for_news_and_updates: '{opted_in_for_news_and_updates}',
          custom_fields: '{custom_fields}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'access.assign',
      class: 'mutation',
      description: 'Assign user access to content or courses in Uscreen.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The user ID to assign access to.' },
          product_id: { type: 'string', description: 'The product or course ID to grant access to.' },
          perform_action_at: { type: 'string', description: 'ISO 8601 datetime to schedule the access assignment.' },
          with_manual_billing: { type: 'boolean', description: 'Whether to apply manual billing for offers.' },
        },
        required: ['user_id', 'product_id'],
      },
      request: {
        method: 'POST',
        path: '/users/{user_id}/access',
        body: {
          product_id: '{product_id}',
          perform_action_at: '{perform_action_at}',
          with_manual_billing: '{with_manual_billing}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.update',
      class: 'mutation',
      description: 'Update an existing Uscreen user account.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The ID of the user to update.' },
          email: { type: 'string', description: 'Updated email address.' },
          first_name: { type: 'string', description: 'Updated first name.' },
          last_name: { type: 'string', description: 'Updated last name.' },
          password: { type: 'string', description: 'Updated password.' },
          opted_in_for_news_and_updates: { type: 'boolean', description: 'Updated opt-in preference.' },
          custom_fields: { type: 'object', description: 'Updated custom fields.' },
        },
        required: ['user_id'],
      },
      request: {
        method: 'PATCH',
        path: '/users/{user_id}',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          password: '{password}',
          opted_in_for_news_and_updates: '{opted_in_for_news_and_updates}',
          custom_fields: '{custom_fields}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.delete',
      class: 'mutation',
      description: 'Delete a Uscreen user account.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The ID of the user to delete.' },
        },
        required: ['user_id'],
      },
      request: {
        method: 'DELETE',
        path: '/users/{user_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'access.revoke',
      class: 'mutation',
      description: "Revoke a user's content or course access in Uscreen.",
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The user ID whose access is being revoked.' },
          product_id: { type: 'string', description: 'The product or course ID to revoke.' },
        },
        required: ['user_id', 'product_id'],
      },
      request: {
        method: 'DELETE',
        path: '/users/{user_id}/access/{product_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List Uscreen users with optional pagination.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, description: 'Page number.' },
          per_page: { type: 'integer', minimum: 1, maximum: 100, description: 'Results per page.' },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { page: '{page}', per_page: '{per_page}' },
      },
    },
  ],
})
