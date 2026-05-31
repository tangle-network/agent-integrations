import { declarativeRestConnector } from './declarative-rest.js'

// Klaviyo pins API stability with a date-based revision header on every request.
// Bumping this is a deliberate migration — leave it as a single source of truth.
const KLAVIYO_API_REVISION = '2024-10-15'

const profileAttributes = {
  type: 'object',
  properties: {
    email: { type: 'string' },
    phone_number: { type: 'string' },
    external_id: { type: 'string' },
    first_name: { type: 'string' },
    last_name: { type: 'string' },
    organization: { type: 'string' },
    title: { type: 'string' },
    location: { type: 'object' },
    properties: { type: 'object' },
  },
}

const eventAttributes = {
  type: 'object',
  properties: {
    properties: { type: 'object' },
    time: { type: 'string' },
    value: { type: 'number' },
    unique_id: { type: 'string' },
    metric: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['metric'] },
            attributes: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
          required: ['type', 'attributes'],
        },
      },
      required: ['data'],
    },
    profile: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['profile'] },
            attributes: profileAttributes,
          },
          required: ['type', 'attributes'],
        },
      },
      required: ['data'],
    },
  },
  required: ['properties', 'metric', 'profile'],
}

export const klaviyoConnector = declarativeRestConnector({
  kind: 'klaviyo',
  displayName: 'Klaviyo',
  description: 'Manage Klaviyo profiles, lists, events, and campaigns through the v2024-10-15 JSON:API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.klaviyo.com/oauth/authorize',
    tokenUrl: 'https://a.klaviyo.com/oauth/token',
    scopes: [
      'accounts:read',
      'profiles:read',
      'profiles:write',
      'lists:read',
      'lists:write',
      'events:read',
      'events:write',
      'campaigns:read',
    ],
    clientIdEnv: 'KLAVIYO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'KLAVIYO_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://a.klaviyo.com',
  defaultHeaders: {
    revision: KLAVIYO_API_REVISION,
    'content-type': 'application/vnd.api+json',
    accept: 'application/vnd.api+json',
  },
  test: { method: 'GET', path: '/api/accounts' },
  capabilities: [
    {
      name: 'profiles.search',
      class: 'read',
      description: 'List or filter Klaviyo profiles. `filter` accepts JSON:API filter syntax like `equals(email,"a@b.com")`.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageCursor: { type: 'string' },
          sort: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/profiles',
        query: {
          filter: '{filter}',
          'page[size]': '{pageSize}',
          'page[cursor]': '{pageCursor}',
          sort: '{sort}',
        },
      },
      requiredScopes: ['profiles:read'],
    },
    {
      name: 'profiles.get',
      class: 'read',
      description: 'Read a single Klaviyo profile by ID.',
      parameters: {
        type: 'object',
        properties: { profileId: { type: 'string' } },
        required: ['profileId'],
      },
      request: { method: 'GET', path: '/api/profiles/{profileId}' },
      requiredScopes: ['profiles:read'],
    },
    {
      name: 'profiles.upsert',
      class: 'mutation',
      description: 'Create or update a Klaviyo profile by email/phone/external_id (deterministic merge on identifiers).',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['profile'] },
              attributes: profileAttributes,
            },
            required: ['type', 'attributes'],
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/profile-import', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['profiles:write'],
    },
    {
      name: 'profiles.update',
      class: 'mutation',
      description: 'Patch attributes on an existing Klaviyo profile.',
      parameters: {
        type: 'object',
        properties: {
          profileId: { type: 'string' },
          data: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['profile'] },
              id: { type: 'string' },
              attributes: profileAttributes,
            },
            required: ['type', 'id', 'attributes'],
          },
        },
        required: ['profileId', 'data'],
      },
      request: { method: 'PATCH', path: '/api/profiles/{profileId}', body: { data: '{data}' } },
      cas: 'optimistic-read-verify',
      requiredScopes: ['profiles:write'],
    },
    {
      name: 'lists.search',
      class: 'read',
      description: 'List Klaviyo lists with optional JSON:API filter.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageCursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/lists',
        query: {
          filter: '{filter}',
          'page[size]': '{pageSize}',
          'page[cursor]': '{pageCursor}',
        },
      },
      requiredScopes: ['lists:read'],
    },
    {
      name: 'lists.create',
      class: 'mutation',
      description: 'Create a Klaviyo list.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['list'] },
              attributes: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
            required: ['type', 'attributes'],
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/lists', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['lists:write'],
    },
    {
      name: 'lists.add-profiles',
      class: 'mutation',
      description: 'Add profiles to a list (subscription-relationship batch).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['profile'] },
                id: { type: 'string' },
              },
              required: ['type', 'id'],
            },
          },
        },
        required: ['listId', 'data'],
      },
      request: {
        method: 'POST',
        path: '/api/lists/{listId}/relationships/profiles',
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['lists:write', 'profiles:write'],
    },
    {
      name: 'events.create',
      class: 'mutation',
      description: 'Track an event for a profile (server-side metric event ingest).',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['event'] },
              attributes: eventAttributes,
            },
            required: ['type', 'attributes'],
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/api/events', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['events:write'],
    },
    {
      name: 'campaigns.search',
      class: 'read',
      description: 'List campaigns. `filter` is required by Klaviyo for campaign queries (e.g. `equals(messages.channel,"email")`).',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string' },
          pageCursor: { type: 'string' },
          sort: { type: 'string' },
        },
        required: ['filter'],
      },
      request: {
        method: 'GET',
        path: '/api/campaigns',
        query: {
          filter: '{filter}',
          'page[cursor]': '{pageCursor}',
          sort: '{sort}',
        },
      },
      requiredScopes: ['campaigns:read'],
    },
  ],
})
