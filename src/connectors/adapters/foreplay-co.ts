import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Foreplay.co (https://public.api.foreplay.co/api).
 *
 * Foreplay is a creative ad library / "swipe file" tool for marketers: it
 * archives Facebook, Instagram, TikTok, and YouTube ads, lets users save them
 * into boards ("swipe files"), and tracks competitor brands via "Spyder".
 *
 * Auth: a single API key, passed in the `Authorization` header. The
 * activepieces catalog entry exposes only the auth shape — no actions or
 * triggers — so the surface below maps the documented public REST resources:
 * discovery (ad search), ad detail lookup, brand search and ad-by-brand
 * fetches, swipe-files (boards) listing and item membership, and Spyder
 * (tracked brand) management.
 */
export const foreplayCoConnector = declarativeRestConnector({
  kind: 'foreplay-co',
  displayName: 'Foreplay',
  description:
    'Search the Foreplay creative ad library, fetch ad and brand detail, and manage swipe files and Spyder-tracked brands.',
  auth: {
    kind: 'api-key',
    hint: 'Foreplay.co API key from Settings → API. Sent in the Authorization header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://public.api.foreplay.co/api',
  credentialPlacement: { kind: 'header', header: 'Authorization' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/swipefiles' },
  capabilities: [
    {
      name: 'discovery.search',
      class: 'read',
      description:
        'Search the global Foreplay Discovery ad library by query, network, niche, language, and other facets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          publisher: { type: 'string' },
          niches: { type: 'string' },
          languages: { type: 'string' },
          formats: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          orderBy: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/discovery/ads',
        query: {
          query: '{query}',
          publisher: '{publisher}',
          niches: '{niches}',
          languages: '{languages}',
          formats: '{formats}',
          start_date: '{startDate}',
          end_date: '{endDate}',
          order: '{orderBy}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'ads.get',
      class: 'read',
      description: 'Fetch the full record for a single ad by its Foreplay ad id.',
      parameters: {
        type: 'object',
        properties: { adId: { type: 'string' } },
        required: ['adId'],
      },
      request: { method: 'GET', path: '/ads/{adId}' },
    },
    {
      name: 'brands.search',
      class: 'read',
      description: 'Search brands in the Foreplay Discovery library by name or domain.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/discovery/brands',
        query: { query: '{query}', limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'brands.get',
      class: 'read',
      description: 'Fetch a single brand record by its Foreplay brand id.',
      parameters: {
        type: 'object',
        properties: { brandId: { type: 'string' } },
        required: ['brandId'],
      },
      request: { method: 'GET', path: '/brands/{brandId}' },
    },
    {
      name: 'brands.ads.list',
      class: 'read',
      description: 'List ads from a single brand, optionally paged.',
      parameters: {
        type: 'object',
        properties: {
          brandId: { type: 'string' },
          publisher: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['brandId'],
      },
      request: {
        method: 'GET',
        path: '/brands/{brandId}/ads',
        query: { publisher: '{publisher}', limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'swipeFiles.list',
      class: 'read',
      description: 'List the authenticated user\'s swipe files (boards).',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' }, cursor: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/swipefiles',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'swipeFiles.get',
      class: 'read',
      description: 'Fetch a single swipe file (board) by id.',
      parameters: {
        type: 'object',
        properties: { swipeFileId: { type: 'string' } },
        required: ['swipeFileId'],
      },
      request: { method: 'GET', path: '/swipefiles/{swipeFileId}' },
    },
    {
      name: 'swipeFiles.ads.list',
      class: 'read',
      description: 'List ads saved inside a given swipe file.',
      parameters: {
        type: 'object',
        properties: {
          swipeFileId: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['swipeFileId'],
      },
      request: {
        method: 'GET',
        path: '/swipefiles/{swipeFileId}/ads',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'swipeFiles.create',
      class: 'mutation',
      description: 'Create a new swipe file (board).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/swipefiles',
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'swipeFiles.ads.add',
      class: 'mutation',
      description: 'Save an ad into a swipe file.',
      parameters: {
        type: 'object',
        properties: {
          swipeFileId: { type: 'string' },
          adId: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['swipeFileId', 'adId'],
      },
      request: {
        method: 'POST',
        path: '/swipefiles/{swipeFileId}/ads',
        body: { ad_id: '{adId}', note: '{note}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'swipeFiles.ads.remove',
      class: 'mutation',
      description: 'Remove an ad from a swipe file.',
      parameters: {
        type: 'object',
        properties: {
          swipeFileId: { type: 'string' },
          adId: { type: 'string' },
        },
        required: ['swipeFileId', 'adId'],
      },
      request: { method: 'DELETE', path: '/swipefiles/{swipeFileId}/ads/{adId}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'spyder.brands.list',
      class: 'read',
      description: 'List the brands the workspace is tracking via Spyder.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' }, cursor: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/spyder/brands',
        query: { limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'spyder.brands.add',
      class: 'mutation',
      description: 'Start tracking a brand in Spyder by Foreplay brand id.',
      parameters: {
        type: 'object',
        properties: { brandId: { type: 'string' } },
        required: ['brandId'],
      },
      request: {
        method: 'POST',
        path: '/spyder/brands',
        body: { brand_id: '{brandId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'spyder.brands.remove',
      class: 'mutation',
      description: 'Stop tracking a brand in Spyder.',
      parameters: {
        type: 'object',
        properties: { brandId: { type: 'string' } },
        required: ['brandId'],
      },
      request: { method: 'DELETE', path: '/spyder/brands/{brandId}' },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'spyder.ads.list',
      class: 'read',
      description: 'List newly captured ads across all Spyder-tracked brands.',
      parameters: {
        type: 'object',
        properties: {
          brandId: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
          limit: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/spyder/ads',
        query: {
          brand_id: '{brandId}',
          start_date: '{startDate}',
          end_date: '{endDate}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
  ],
})
