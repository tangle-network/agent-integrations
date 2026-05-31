import { declarativeRestConnector } from './declarative-rest.js'

// MailerLite v2 ("MailerLite Connect") publishes its REST surface at
// connect.mailerlite.com/api. The activepieces piece authenticates with a
// long-lived API token (Authorization: Bearer …) issued from the MailerLite
// dashboard.
export const mailerLiteConnector = declarativeRestConnector({
  kind: 'mailer-lite',
  displayName: 'MailerLite',
  description:
    'Manage MailerLite subscribers and groups in the email marketing platform.',
  auth: {
    kind: 'api-key',
    hint: 'MailerLite API token (Integrations → API). Sent as Authorization: Bearer.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://connect.mailerlite.com/api',
  test: { method: 'GET', path: '/subscribers', query: { limit: '1' } },
  capabilities: [
    {
      name: 'subscribers.upsert',
      class: 'mutation',
      description:
        'Create or update a subscriber by email. Mirrors the activepieces createOrUpdateSubscriber action.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          fields: {
            type: 'object',
            description:
              'Custom subscriber field values keyed by MailerLite field name (e.g. name, last_name, company).',
          },
          groups: {
            type: 'array',
            items: { type: 'string' },
            description: 'Group IDs the subscriber should belong to after upsert.',
          },
          status: {
            type: 'string',
            enum: ['active', 'unsubscribed', 'unconfirmed', 'bounced', 'junk'],
            description: 'Defaults to active when omitted.',
          },
          subscribed_at: {
            type: 'string',
            description: 'ISO-8601 timestamp recording when consent was captured.',
          },
          opted_in_at: {
            type: 'string',
            description: 'ISO-8601 timestamp recording when double opt-in confirmation occurred.',
          },
          ip_address: {
            type: 'string',
            description: 'IP address recorded at signup.',
          },
          optin_ip: {
            type: 'string',
            description: 'IP address recorded at opt-in confirmation.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/subscribers',
        body: {
          email: '{email}',
          fields: '{fields}',
          groups: '{groups}',
          status: '{status}',
          subscribed_at: '{subscribed_at}',
          opted_in_at: '{opted_in_at}',
          ip_address: '{ip_address}',
          optin_ip: '{optin_ip}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.groups.add',
      class: 'mutation',
      description:
        'Add an existing subscriber to a group. Mirrors the activepieces addSubscriberToGroupAction.',
      parameters: {
        type: 'object',
        properties: {
          subscriberId: {
            type: 'string',
            description: 'MailerLite subscriber ID or email.',
          },
          groupId: { type: 'string' },
        },
        required: ['subscriberId', 'groupId'],
      },
      request: {
        method: 'POST',
        path: '/subscribers/{subscriberId}/groups/{groupId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.groups.remove',
      class: 'mutation',
      description:
        'Remove a subscriber from a group. Mirrors the activepieces removeSubscriberFromGroupAction (destructive).',
      parameters: {
        type: 'object',
        properties: {
          subscriberId: {
            type: 'string',
            description: 'MailerLite subscriber ID or email.',
          },
          groupId: { type: 'string' },
        },
        required: ['subscriberId', 'groupId'],
      },
      request: {
        method: 'DELETE',
        path: '/subscribers/{subscriberId}/groups/{groupId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.find',
      class: 'read',
      description:
        'Look up a subscriber by ID or email. Mirrors the activepieces findSubscriberAction.',
      parameters: {
        type: 'object',
        properties: {
          searchValue: {
            type: 'string',
            description: 'Subscriber ID or email address to resolve.',
          },
        },
        required: ['searchValue'],
      },
      request: {
        method: 'GET',
        path: '/subscribers/{searchValue}',
      },
    },
  ],
})
