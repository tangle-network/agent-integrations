import { declarativeRestConnector } from './declarative-rest.js'

export const talkableConnector = declarativeRestConnector({
  kind: 'talkable',
  displayName: 'Talkable',
  description: 'Manage referral marketing campaigns, advocate referrals, and track referral rewards.',
  auth: { kind: 'api-key', hint: 'Talkable API key with site ID.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.talkable.com/v2',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'advocates.list',
      class: 'read',
      description: 'List advocates (people who are referring others).',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, limit: { type: 'integer' } },
        required: ['site'],
      },
      request: { method: 'GET', path: '/sites/{site}/advocates', query: { limit: '{limit}' } },
    },
    {
      name: 'advocates.get',
      class: 'read',
      description: 'Get a specific advocate by email.',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, email: { type: 'string' } },
        required: ['site', 'email'],
      },
      request: { method: 'GET', path: '/sites/{site}/advocates/{email}' },
    },
    {
      name: 'referrals.list',
      class: 'read',
      description: 'List referrals for a site.',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' } },
        required: ['site'],
      },
      request: { method: 'GET', path: '/sites/{site}/referrals', query: { status: '{status}', limit: '{limit}' } },
    },
    {
      name: 'referrals.create',
      class: 'mutation',
      description: 'Create a referral (track a new referral event).',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          advocateEmail: { type: 'string' },
          friendEmail: { type: 'string' },
          campaignTag: { type: 'string' },
        },
        required: ['site', 'advocateEmail', 'friendEmail', 'campaignTag'],
      },
      request: {
        method: 'POST',
        path: '/sites/{site}/referrals',
        body: {
          advocate_email: '{advocateEmail}',
          friend_email: '{friendEmail}',
          campaign_tag: '{campaignTag}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rewards.list',
      class: 'read',
      description: 'List rewards for a site.',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, limit: { type: 'integer' } },
        required: ['site'],
      },
      request: { method: 'GET', path: '/sites/{site}/rewards', query: { limit: '{limit}' } },
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List campaigns for a site.',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, limit: { type: 'integer' } },
        required: ['site'],
      },
      request: { method: 'GET', path: '/sites/{site}/campaigns', query: { limit: '{limit}' } },
    },
    {
      name: 'events.track',
      class: 'mutation',
      description: 'Track a purchase or custom event for referral attribution.',
      parameters: {
        type: 'object',
        properties: {
          site: { type: 'string' },
          email: { type: 'string' },
          eventCategory: { type: 'string' },
          eventNumber: { type: 'string' },
          subtotal: { type: 'number' },
        },
        required: ['site', 'email', 'eventCategory', 'eventNumber', 'subtotal'],
      },
      request: {
        method: 'POST',
        path: '/sites/{site}/events',
        body: {
          email: '{email}',
          event_category: '{eventCategory}',
          event_number: '{eventNumber}',
          subtotal: '{subtotal}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'offers.list',
      class: 'read',
      description: 'List offers (rewards) for a campaign.',
      parameters: {
        type: 'object',
        properties: { site: { type: 'string' }, campaignTag: { type: 'string' } },
        required: ['site', 'campaignTag'],
      },
      request: { method: 'GET', path: '/sites/{site}/campaigns/{campaignTag}/offers' },
    },
  ],
})
