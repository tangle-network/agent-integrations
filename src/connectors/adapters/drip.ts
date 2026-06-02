import { declarativeRestConnector } from './declarative-rest.js'

export const dripConnector = declarativeRestConnector({
  kind: 'drip',
  displayName: 'Drip',
  description: 'Manage subscribers, campaigns, and tags in the Drip e-commerce CRM.',
  auth: {
    kind: 'api-key',
    hint: 'Drip API token from account settings. The connection must also store the account_id.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.getdrip.com/v3',
  test: { method: 'GET', path: '/accounts' },
  capabilities: [
    {
      name: 'subscribers.add_to_campaign',
      class: 'mutation',
      description: 'Add a subscriber to a Drip campaign.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Drip account ID' },
          email: { type: 'string', description: 'Subscriber email address' },
          campaign_id: { type: 'string', description: 'Campaign ID to add to' },
          first_name: { type: 'string', description: 'Subscriber first name' },
          last_name: { type: 'string', description: 'Subscriber last name' },
          phone: { type: 'string', description: 'Subscriber phone number' },
          address: { type: 'string', description: 'Subscriber address' },
          city: { type: 'string', description: 'Subscriber city' },
          state: { type: 'string', description: 'Subscriber state' },
          zip: { type: 'string', description: 'Subscriber zip code' },
          country: { type: 'string', description: 'Subscriber country' },
        },
        required: ['account_id', 'email', 'campaign_id'],
      },
      request: {
        method: 'POST',
        path: '/accounts/{account_id}/subscribers',
        body: {
          subscribers: [
            {
              email: '{email}',
              campaign_id: '{campaign_id}',
              first_name: '{first_name}',
              last_name: '{last_name}',
              phone: '{phone}',
              address: '{address}',
              city: '{city}',
              state: '{state}',
              zip: '{zip}',
              country: '{country}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.apply_tag',
      class: 'mutation',
      description: 'Apply a tag to a Drip subscriber.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Drip account ID' },
          email: { type: 'string', description: 'Subscriber email address' },
          tag: { type: 'string', description: 'Tag to apply' },
        },
        required: ['account_id', 'email', 'tag'],
      },
      request: {
        method: 'POST',
        path: '/accounts/{account_id}/tags',
        body: {
          tags: [
            {
              email: '{email}',
              tag: '{tag}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'subscribers.upsert',
      class: 'mutation',
      description: 'Create or update a Drip subscriber.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Drip account ID' },
          email: { type: 'string', description: 'Subscriber email address' },
          first_name: { type: 'string', description: 'Subscriber first name' },
          last_name: { type: 'string', description: 'Subscriber last name' },
          phone: { type: 'string', description: 'Subscriber phone number' },
          address: { type: 'string', description: 'Subscriber address' },
          city: { type: 'string', description: 'Subscriber city' },
          state: { type: 'string', description: 'Subscriber state' },
          zip: { type: 'string', description: 'Subscriber zip code' },
          country: { type: 'string', description: 'Subscriber country' },
        },
        required: ['account_id', 'email'],
      },
      request: {
        method: 'POST',
        path: '/accounts/{account_id}/subscribers',
        body: {
          subscribers: [
            {
              email: '{email}',
              first_name: '{first_name}',
              last_name: '{last_name}',
              phone: '{phone}',
              address: '{address}',
              city: '{city}',
              state: '{state}',
              zip: '{zip}',
              country: '{country}',
            },
          ],
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'subscribers.delete',
      class: 'mutation',
      description: 'Delete a Drip subscriber by id or email.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Drip account ID' },
          id_or_email: {
            type: 'string',
            description: 'Subscriber id or URL-encoded email to delete.',
          },
        },
        required: ['account_id', 'id_or_email'],
      },
      request: {
        method: 'DELETE',
        path: '/accounts/{account_id}/subscribers/{id_or_email}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'events.record',
      class: 'mutation',
      description: 'Record a custom event for a Drip subscriber.',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'string', description: 'Drip account ID' },
          email: { type: 'string', description: 'Subscriber email the event belongs to.' },
          action: { type: 'string', description: 'Event action name, e.g. "Purchased a product".' },
          properties: {
            type: 'object',
            description: 'Free-form key/value properties to attach to the event.',
          },
          occurred_at: {
            type: 'string',
            description: 'ISO-8601 timestamp the event occurred at.',
          },
        },
        required: ['account_id', 'email', 'action'],
      },
      request: {
        method: 'POST',
        path: '/accounts/{account_id}/events',
        body: {
          events: [
            {
              email: '{email}',
              action: '{action}',
              properties: '{properties}',
              occurred_at: '{occurred_at}',
            },
          ],
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
