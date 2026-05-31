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
  ],
})
