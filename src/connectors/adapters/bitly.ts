import { declarativeRestConnector } from './declarative-rest.js'

export const bitlyConnector = declarativeRestConnector({
  kind: 'bitly',
  displayName: 'Bitly',
  description: 'URL shortening and link management platform with analytics.',
  auth: { kind: 'api-key', hint: 'Bitly access token (used as Bearer credentials).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api-ssl.bitly.com/v4',
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'bitlink.get',
      class: 'read',
      description: 'Get details for a Bitlink.',
      parameters: {
        type: 'object',
        properties: { bitlink: { type: 'string' } },
        required: ['bitlink'],
      },
      request: { method: 'GET', path: '/bitlinks/{bitlink}' },
    },
    {
      name: 'bitlink.create',
      class: 'mutation',
      description: 'Shorten a long URL into a Bitlink.',
      parameters: {
        type: 'object',
        properties: {
          long_url: { type: 'string' },
          domain: { type: 'string' },
          group_guid: { type: 'string' },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          deeplinks: { type: 'array', items: { type: 'object' } },
        },
        required: ['long_url'],
      },
      request: {
        method: 'POST',
        path: '/bitlinks',
        body: {
          long_url: '{long_url}',
          domain: '{domain}',
          group_guid: '{group_guid}',
          title: '{title}',
          tags: '{tags}',
          deeplinks: '{deeplinks}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bitlink.update',
      class: 'mutation',
      description: 'Update title, tags, archival state, or deeplinks on a Bitlink.',
      parameters: {
        type: 'object',
        properties: {
          bitlink: { type: 'string' },
          title: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          archived: { type: 'boolean' },
          deeplinks: { type: 'array', items: { type: 'object' } },
        },
        required: ['bitlink'],
      },
      request: {
        method: 'PATCH',
        path: '/bitlinks/{bitlink}',
        body: {
          title: '{title}',
          tags: '{tags}',
          archived: '{archived}',
          deeplinks: '{deeplinks}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'bitlink.archive',
      class: 'mutation',
      description: 'Archive a Bitlink (Bitly has no hard delete; archival is the destructive op).',
      parameters: {
        type: 'object',
        properties: { bitlink: { type: 'string' } },
        required: ['bitlink'],
      },
      request: {
        method: 'PATCH',
        path: '/bitlinks/{bitlink}',
        body: { archived: true },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'qr.create',
      class: 'mutation',
      description: 'Create a QR code for a destination URL or existing Bitlink.',
      parameters: {
        type: 'object',
        properties: {
          group_guid: { type: 'string' },
          destination: { type: 'object' },
          render_customizations: { type: 'object' },
          title: { type: 'string' },
          archived: { type: 'boolean' },
        },
        required: ['group_guid', 'destination'],
      },
      request: {
        method: 'POST',
        path: '/groups/{group_guid}/qr-codes',
        body: {
          destination: '{destination}',
          render_customizations: '{render_customizations}',
          title: '{title}',
          archived: '{archived}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
