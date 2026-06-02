import { declarativeRestConnector } from './declarative-rest.js'

export const influencersClubConnector = declarativeRestConnector({
  kind: 'influencers-club',
  displayName: 'Influencers.club',
  description:
    'Enrich and discover social-media creators on Influencers.club for marketing campaigns: resolve creators by email or handle and find lookalike profiles.',
  auth: {
    kind: 'api-key',
    hint: 'Influencers.club API key, sent as the X-API-Key header. Issued from Account → API.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.influencers.club/v1',
  credentialPlacement: { kind: 'header', header: 'X-API-Key' },
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'creators.enrich_by_email',
      class: 'mutation',
      description:
        'Enrich a creator profile from a known email address, optionally filtering by platform and follower count. Maps to the catalog action enrich.creator.by.email.',
      parameters: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            description: 'The email address of the creator to enrich.',
          },
          exclude_platforms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Social platforms to exclude from the enrichment response.',
          },
          min_followers: {
            type: 'integer',
            description: 'Minimum follower count filter. Defaults to 1000 server-side.',
          },
          email_required: {
            type: 'string',
            description:
              'Controls how the upstream handles email availability on returned profiles.',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/creators/enrich/email',
        body: {
          email: '{email}',
          exclude_platforms: '{exclude_platforms}',
          min_followers: '{min_followers}',
          email_required: '{email_required}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'creators.enrich_by_handle',
      class: 'mutation',
      description:
        'Enrich a creator profile from a social-media handle and platform. Maps to the catalog action enrich.creator.by.handle.',
      parameters: {
        type: 'object',
        properties: {
          handle: {
            type: 'string',
            description: 'The social-media handle (without leading @) of the creator.',
          },
          platform: {
            type: 'string',
            description:
              'The social-media platform that owns the handle (e.g. instagram, tiktok, youtube).',
          },
          include_lookalikes: {
            type: 'boolean',
            description:
              'Include similar creators alongside the primary enrichment. Defaults to true on the upstream.',
          },
          email_required: {
            type: 'string',
            description: 'Controls upstream handling of email availability.',
          },
        },
        required: ['handle', 'platform'],
      },
      request: {
        method: 'POST',
        path: '/creators/enrich/handle',
        body: {
          handle: '{handle}',
          platform: '{platform}',
          include_lookalikes: '{include_lookalikes}',
          email_required: '{email_required}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'creators.find_similar',
      class: 'read',
      description:
        'Find creators similar to a seed profile identified by URL, handle, or user id, with optional follower / engagement / verification filters. Maps to the catalog action find.similar.creator.',
      parameters: {
        type: 'object',
        properties: {
          filter_key: {
            type: 'string',
            description:
              'The type of identifier supplied in filter_value (e.g. url, handle, user_id).',
          },
          filter_value: {
            type: 'string',
            description: 'The platform URL, profile handle, or upstream user id of the seed creator.',
          },
          platform: {
            type: 'string',
            description: 'Optional platform hint for the seed profile.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of similar creators to return (1-50).',
          },
          number_of_followers: {
            type: 'object',
            description: 'Follower-count range filter, expressed as { min, max }.',
            properties: {
              min: { type: 'integer' },
              max: { type: 'integer' },
            },
          },
          engagement_percent: {
            type: 'object',
            description: 'Engagement-rate range filter, expressed as { min, max }.',
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
            },
          },
          is_verified: {
            type: 'boolean',
            description: 'When true, restrict results to verified creators.',
          },
          exclude_private_profile: {
            type: 'boolean',
            description: 'When true, drop creators whose profile is private.',
          },
        },
        required: ['filter_key', 'filter_value'],
      },
      request: {
        method: 'POST',
        path: '/creators/similar',
        body: {
          filter_key: '{filter_key}',
          filter_value: '{filter_value}',
          platform: '{platform}',
          limit: '{limit}',
          number_of_followers: '{number_of_followers}',
          engagement_percent: '{engagement_percent}',
          is_verified: '{is_verified}',
          exclude_private_profile: '{exclude_private_profile}',
        },
      },
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description:
        'Create a new influencer list. Lists group creators for campaigns, exports, and bulk outreach.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the new list.' },
          description: { type: 'string', description: 'Optional list description.' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/lists',
        body: {
          name: '{name}',
          description: '{description}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.add',
      class: 'mutation',
      description:
        'Add a creator (by upstream creator id) to an influencer list. Uses native upsert semantics — adding the same creator twice is a no-op.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'Target list id.' },
          creator_id: { type: 'string', description: 'Upstream creator id to add to the list.' },
        },
        required: ['list_id', 'creator_id'],
      },
      request: {
        method: 'POST',
        path: '/lists/{list_id}/creators',
        body: {
          creator_id: '{creator_id}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lists.delete',
      class: 'mutation',
      description: 'Delete an influencer list and all of its memberships.',
      parameters: {
        type: 'object',
        properties: {
          list_id: { type: 'string', description: 'List id to delete.' },
        },
        required: ['list_id'],
      },
      request: {
        method: 'DELETE',
        path: '/lists/{list_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
