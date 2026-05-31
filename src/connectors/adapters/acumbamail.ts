import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Acumbamail adapter — REST/form API at https://acumbamail.com/api/1/.
 *
 * Auth: API key, forwarded as the `auth_token` query parameter on every
 * call (Acumbamail does not honor Authorization headers).
 *
 * Actions mirror the activepieces catalog entry for `acumbamail`: subscriber
 * lifecycle, list lifecycle, and template duplication. Response format is
 * forced to JSON via the `response_type=json` query knob included on every
 * request that supports it.
 */
export const acumbamailConnector = declarativeRestConnector({
  kind: 'acumbamail',
  displayName: 'Acumbamail',
  description: 'Manage Acumbamail subscriber lists, subscribers, and email templates.',
  auth: { kind: 'api-key', hint: 'Acumbamail API auth token from account settings.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://acumbamail.com/api/1',
  credentialPlacement: { kind: 'query', parameter: 'auth_token' },
  test: {
    method: 'POST',
    path: '/getLists/',
    query: { response_type: 'json' },
  },
  capabilities: [
    {
      name: 'subscriber.add_update',
      class: 'mutation',
      description:
        'Add a subscriber to a list, or update merge fields on an existing subscriber if update_subscriber is enabled.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          merge_fields: { type: 'object' },
          double_option: { type: 'boolean' },
          update_subscriber: { type: 'boolean' },
        },
        required: ['list_id', 'merge_fields'],
      },
      request: {
        method: 'POST',
        path: '/addSubscriber/',
        query: {
          response_type: 'json',
          list_id: '{list_id}',
          merge_fields: '{merge_fields}',
          double_option: '{double_option}',
          update_subscriber: '{update_subscriber}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a new subscriber list with sender identity and company contact info.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          sender_email: { type: 'string' },
          company: { type: 'string' },
          country: { type: 'string' },
          city: { type: 'string' },
          address: { type: 'string' },
          phone: { type: 'string' },
        },
        required: ['name', 'sender_email'],
      },
      request: {
        method: 'POST',
        path: '/createList/',
        query: {
          response_type: 'json',
          name: '{name}',
          sender_email: '{sender_email}',
          company: '{company}',
          country: '{country}',
          city: '{city}',
          address: '{address}',
          phone: '{phone}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriber.unsubscribe',
      class: 'mutation',
      description: 'Unsubscribe a subscriber from a specific list without removing them from the account.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['list_id', 'email'],
      },
      request: {
        method: 'POST',
        path: '/unsubscribeSubscriber/',
        query: {
          response_type: 'json',
          list_id: '{list_id}',
          email: '{email}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Permanently delete a subscriber list and all of its subscribers.',
      parameters: {
        type: 'object',
        properties: { list_id: { type: 'string' } },
        required: ['list_id'],
      },
      request: {
        method: 'POST',
        path: '/deleteList/',
        query: {
          response_type: 'json',
          list_id: '{list_id}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'templates.duplicate',
      class: 'mutation',
      description: 'Duplicate an existing email template under a new name.',
      parameters: {
        type: 'object',
        properties: {
          template_id: { type: 'string' },
          template_name: { type: 'string' },
        },
        required: ['template_id', 'template_name'],
      },
      request: {
        method: 'POST',
        path: '/duplicateTemplate/',
        query: {
          response_type: 'json',
          template_id: '{template_id}',
          template_name: '{template_name}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscriber.search',
      class: 'read',
      description: 'Look up a subscriber on a given list by email address.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          subscriber: { type: 'string' },
        },
        required: ['list_id', 'subscriber'],
      },
      request: {
        method: 'POST',
        path: '/getSubscriberDetails/',
        query: {
          response_type: 'json',
          list_id: '{list_id}',
          subscriber: '{subscriber}',
        },
      },
    },
    {
      name: 'subscriber.remove',
      class: 'mutation',
      description: 'Hard-delete a subscriber from a list (distinct from unsubscribe — removes the record).',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['list_id', 'email'],
      },
      request: {
        method: 'POST',
        path: '/deleteSubscriber/',
        query: {
          response_type: 'json',
          list_id: '{list_id}',
          email: '{email}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'lists.query',
      class: 'read',
      description: 'List all subscriber lists on the account.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'POST',
        path: '/getLists/',
        query: { response_type: 'json' },
      },
    },
  ],
})
