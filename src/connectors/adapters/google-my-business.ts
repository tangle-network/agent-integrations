import { declarativeRestConnector } from './declarative-rest.js'

// Google Business Profile (formerly Google My Business) is fronted by three
// separate REST hosts, each with its own version prefix:
//
//   - https://mybusinessaccountmanagement.googleapis.com/v1
//       lists the accounts the authenticated user owns or co-manages.
//       We use it as the connector's test ping and to discover the account
//       ids the other surfaces need as a path prefix.
//
//   - https://mybusinessbusinessinformation.googleapis.com/v1
//       enumerates locations (storefronts) under each account.
//
//   - https://mybusiness.googleapis.com/v4
//       legacy endpoint that still hosts the reviews + reply surface; Google
//       never migrated reviews onto the split v1 APIs. This is the action
//       surface the activepieces piece exposes (createReply).
//
// `declarativeRestConnector` only carries a single `baseUrl`, so we pin it to
// account-management (cheapest test ping, no path args) and inline absolute
// URLs for the other two hosts. `new URL(absolute, base)` returns the
// absolute URL unchanged, so this composes correctly.
//
// OAuth scope `https://www.googleapis.com/auth/business.manage` is the single
// scope that covers read + write across all three surfaces, which matches the
// activepieces piece (it ships one oauth2 auth object, not a per-action split).
export const googleMyBusinessConnector = declarativeRestConnector({
  kind: 'google-my-business',
  displayName: 'Google My Business',
  description:
    'Manage Google Business Profile (formerly Google My Business): list accounts and locations, read customer reviews, and post owner replies.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/business.manage'],
    clientIdEnv: 'GOOGLE_MY_BUSINESS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_MY_BUSINESS_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://mybusinessaccountmanagement.googleapis.com',
  test: { method: 'GET', path: '/v1/accounts' },
  capabilities: [
    {
      name: 'accounts.list',
      class: 'read',
      description:
        'List Business Profile accounts the authenticated user owns or co-manages.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 50 },
          pageToken: { type: 'string' },
          filter: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/accounts',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          filter: '{filter}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      name: 'locations.list',
      class: 'read',
      description:
        'List locations under a Business Profile account (Business Information API).',
      parameters: {
        type: 'object',
        properties: {
          accountId: {
            type: 'string',
            description:
              'Bare account id (the trailing segment of `accounts/{accountId}`).',
          },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
          filter: { type: 'string' },
          readMask: {
            type: 'string',
            description:
              'Field mask selecting which Location fields to return, e.g. `name,title,storefrontAddress`.',
          },
        },
        required: ['accountId', 'readMask'],
      },
      request: {
        method: 'GET',
        path: 'https://mybusinessbusinessinformation.googleapis.com/v1/accounts/{accountId}/locations',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          filter: '{filter}',
          readMask: '{readMask}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      name: 'reviews.list',
      class: 'read',
      description:
        'List customer reviews for a location (legacy v4 endpoint — Google never migrated reviews onto the v1 split APIs).',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          pageSize: { type: 'integer', minimum: 1, maximum: 50 },
          pageToken: { type: 'string' },
          orderBy: {
            type: 'string',
            description:
              'Sort order, e.g. `updateTime desc` or `rating desc`.',
          },
        },
        required: ['accountId', 'locationId'],
      },
      request: {
        method: 'GET',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          orderBy: '{orderBy}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      name: 'reviews.get',
      class: 'read',
      description: 'Get a single customer review by id.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          reviewId: { type: 'string' },
        },
        required: ['accountId', 'locationId', 'reviewId'],
      },
      request: {
        method: 'GET',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      // Mirrors the activepieces `create.reply` action (`createReply`).
      // The legacy v4 endpoint uses PUT for upsert semantics: posting the
      // same reply twice replaces (not duplicates) the owner response, which
      // makes this naturally idempotent on (locationId, reviewId).
      name: 'reviews.reply.create',
      class: 'mutation',
      description:
        'Create or replace the owner reply on a customer review (idempotent upsert on the review name).',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          reviewId: { type: 'string' },
          comment: {
            type: 'string',
            description: 'Reply text, up to 4096 characters.',
            maxLength: 4096,
          },
        },
        required: ['accountId', 'locationId', 'reviewId', 'comment'],
      },
      request: {
        method: 'PUT',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply',
        body: { comment: '{comment}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      name: 'reviews.reply.delete',
      class: 'mutation',
      description: 'Delete the owner reply on a customer review.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          reviewId: { type: 'string' },
        },
        required: ['accountId', 'locationId', 'reviewId'],
      },
      request: {
        method: 'DELETE',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/reviews/{reviewId}/reply',
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
  ],
})
