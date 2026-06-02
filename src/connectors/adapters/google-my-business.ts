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
    {
      // GBP "posts" — short-lived updates that surface on the storefront's
      // listing. The legacy v4 endpoint is the only published surface; the
      // Business Posts v1 API was retired in 2022 and Google never produced a
      // replacement. Repeating a POST produces a duplicate localPost, so the
      // MutationGuard idempotency-key layer must dedupe above the connector.
      name: 'localPosts.create',
      class: 'mutation',
      description:
        'Publish a Google Business Profile local post (status update, offer, event, or call-to-action) on a location.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          languageCode: {
            type: 'string',
            description: 'BCP-47 language code, e.g. "en".',
          },
          summary: {
            type: 'string',
            description: 'Post body text (up to 1,500 characters).',
            maxLength: 1500,
          },
          topicType: {
            type: 'string',
            description: 'STANDARD | EVENT | OFFER | ALERT.',
          },
          callToAction: {
            type: 'object',
            description: 'Optional { actionType, url } block, e.g. { actionType: "LEARN_MORE", url: "https://..." }.',
          },
          event: {
            type: 'object',
            description: 'For topicType=EVENT: { title, schedule: { startDate, endDate, ... } }.',
          },
          offer: {
            type: 'object',
            description: 'For topicType=OFFER: { couponCode, redeemOnlineUrl, termsConditions }.',
          },
          media: {
            type: 'array',
            description: 'Optional MediaItem list to attach images/video to the post.',
          },
        },
        required: ['accountId', 'locationId', 'languageCode', 'summary'],
      },
      request: {
        method: 'POST',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts',
        body: {
          languageCode: '{languageCode}',
          summary: '{summary}',
          topicType: '{topicType}',
          callToAction: '{callToAction}',
          event: '{event}',
          offer: '{offer}',
          media: '{media}',
        },
      },
      // GBP localPosts has no requestId / idempotency-key on POST; consecutive
      // calls produce duplicate posts. MutationGuard's idempotency-key layer
      // is the only guard.
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      name: 'localPosts.delete',
      class: 'mutation',
      description:
        'Delete a local post from a location. Repeating the call on an already-deleted post yields 404 but is idempotent in effect.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          localPostId: { type: 'string' },
        },
        required: ['accountId', 'locationId', 'localPostId'],
      },
      request: {
        method: 'DELETE',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/localPosts/{localPostId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      // GBP "media" — photos/videos on a location's profile. The legacy v4
      // /media endpoint accepts a MediaItem body with either a sourceUrl
      // (Google fetches it) or a reference from /media:startUpload (multi-step
      // resumable upload). We expose the sourceUrl path because it's a single
      // request the declarative-rest engine can model cleanly; bytestream
      // upload is a separate hand-rolled adapter when needed.
      name: 'media.create',
      class: 'mutation',
      description:
        'Upload a photo or video to a Google Business Profile location via the v4 /media endpoint. Pass a sourceUrl Google can fetch (HTTPS, publicly reachable). For bytestream uploads use the /media:startUpload + PUT bytestream flow instead.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          locationId: { type: 'string' },
          mediaFormat: {
            type: 'string',
            description: 'PHOTO | VIDEO.',
          },
          locationAssociation: {
            type: 'object',
            description: 'Where the media attaches, e.g. { category: "EXTERIOR" } or { priceListItemId: "..." }.',
          },
          sourceUrl: {
            type: 'string',
            description: 'Public HTTPS URL Google should fetch the media from.',
          },
          description: {
            type: 'string',
            description: 'Optional caption shown alongside the media.',
          },
        },
        required: ['accountId', 'locationId', 'mediaFormat', 'sourceUrl'],
      },
      request: {
        method: 'POST',
        path: 'https://mybusiness.googleapis.com/v4/accounts/{accountId}/locations/{locationId}/media',
        body: {
          mediaFormat: '{mediaFormat}',
          locationAssociation: '{locationAssociation}',
          sourceUrl: '{sourceUrl}',
          description: '{description}',
        },
      },
      // GBP media POST has no idempotency token; consecutive calls produce
      // duplicate media items. MutationGuard's idempotency-key layer is the
      // only guard.
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
  ],
})
