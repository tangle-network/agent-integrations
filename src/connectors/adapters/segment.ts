import { declarativeRestConnector } from './declarative-rest.js'

// Segment Public API: workspace-scoped Bearer REST surface for source / destination
// configuration, tracking-plan management, and customer profile reads (Personas /
// Unify). The Public API authenticates with a workspace-issued Personal Access
// Token from app.segment.com → Settings → Workspace Settings → Access Management.
//
// Region note: the Public API itself is global (api.segmentapis.com) regardless
// of which region the workspace's data plane runs in. Workspace selection is
// implicit in the token; callers do NOT pass a workspace id on most routes (Segment
// resolves it from the token), so capabilities here mirror the documented routes
// without an explicit workspaceId parameter.
//
// Profile API (per-customer attribute / event reads) lives on a per-workspace
// host: profiles.segment.com/v1/spaces/{spaceId}/collections/users/profiles/...
// That surface uses HTTP Basic auth with an Access Secret, not the Public API
// Bearer token, so it is intentionally NOT modeled here. Tracking / Identify
// ingest (api.segment.io/v1/track, /v1/identify, /v1/batch) uses a per-source
// Write Key and is also a separate auth scope — agents emitting events should
// use a dedicated Segment tracking connector, not this adapter.

export const segmentConnector = declarativeRestConnector({
  kind: 'segment',
  displayName: 'Segment',
  description: 'Manage Segment workspace sources, destinations, tracking plans, and audiences via the Public API (Bearer).',
  auth: {
    kind: 'api-key',
    hint: 'Segment Public API personal access token (app.segment.com → Settings → Workspace Settings → Access Management → Tokens).',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.segmentapis.com',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'sources.search',
      class: 'read',
      description: 'List the sources configured in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pagination: {
            type: 'object',
            description: 'Pagination cursor returned by the previous response.',
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 200 },
              cursor: { type: 'string' },
            },
          },
        },
      },
      request: {
        method: 'GET',
        path: '/sources',
        query: { 'pagination.count': '{pagination.count}', 'pagination.cursor': '{pagination.cursor}' },
      },
    },
    {
      name: 'sources.get',
      class: 'read',
      description: 'Read a single source by id.',
      parameters: {
        type: 'object',
        properties: { sourceId: { type: 'string' } },
        required: ['sourceId'],
      },
      request: { method: 'GET', path: '/sources/{sourceId}' },
    },
    {
      name: 'sources.create',
      class: 'mutation',
      description: 'Create a new source in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'URL-safe slug used in tracking calls.' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
          metadataId: { type: 'string', description: 'Source-type metadata id (e.g. catalog item for "javascript", "python", "http-api").' },
          settings: { type: 'object', description: 'Source-type-specific settings.' },
        },
        required: ['slug', 'metadataId'],
      },
      request: { method: 'POST', path: '/sources', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'sources.update',
      class: 'mutation',
      description: 'Update an existing source (name, enabled state, settings).',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
          settings: { type: 'object' },
        },
        required: ['sourceId'],
      },
      request: {
        method: 'PATCH',
        path: '/sources/{sourceId}',
        body: { name: '{name}', enabled: '{enabled}', settings: '{settings}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sources.delete',
      class: 'mutation',
      description: 'Delete a source from the workspace.',
      parameters: {
        type: 'object',
        properties: { sourceId: { type: 'string' } },
        required: ['sourceId'],
      },
      request: { method: 'DELETE', path: '/sources/{sourceId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'destinations.search',
      class: 'read',
      description: 'List destinations configured across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pagination: {
            type: 'object',
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 200 },
              cursor: { type: 'string' },
            },
          },
        },
      },
      request: {
        method: 'GET',
        path: '/destinations',
        query: { 'pagination.count': '{pagination.count}', 'pagination.cursor': '{pagination.cursor}' },
      },
    },
    {
      name: 'destinations.get',
      class: 'read',
      description: 'Read a single destination by id.',
      parameters: {
        type: 'object',
        properties: { destinationId: { type: 'string' } },
        required: ['destinationId'],
      },
      request: { method: 'GET', path: '/destinations/{destinationId}' },
    },
    {
      name: 'destinations.create',
      class: 'mutation',
      description: 'Create a new destination tied to a source.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          metadataId: { type: 'string', description: 'Destination-type metadata id from the catalog.' },
          enabled: { type: 'boolean' },
          name: { type: 'string' },
          settings: { type: 'object', description: 'Destination-type-specific settings (API keys, mappings, etc.).' },
        },
        required: ['sourceId', 'metadataId'],
      },
      request: { method: 'POST', path: '/destinations', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'destinations.update',
      class: 'mutation',
      description: 'Update an existing destination configuration.',
      parameters: {
        type: 'object',
        properties: {
          destinationId: { type: 'string' },
          enabled: { type: 'boolean' },
          name: { type: 'string' },
          settings: { type: 'object' },
        },
        required: ['destinationId'],
      },
      request: {
        method: 'PATCH',
        path: '/destinations/{destinationId}',
        body: { enabled: '{enabled}', name: '{name}', settings: '{settings}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'destinations.delete',
      class: 'mutation',
      description: 'Remove a destination from the workspace.',
      parameters: {
        type: 'object',
        properties: { destinationId: { type: 'string' } },
        required: ['destinationId'],
      },
      request: { method: 'DELETE', path: '/destinations/{destinationId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'tracking-plans.search',
      class: 'read',
      description: 'List tracking plans defined in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          pagination: {
            type: 'object',
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 200 },
              cursor: { type: 'string' },
            },
          },
        },
      },
      request: {
        method: 'GET',
        path: '/tracking-plans',
        query: { 'pagination.count': '{pagination.count}', 'pagination.cursor': '{pagination.cursor}' },
      },
    },
    {
      name: 'tracking-plans.get',
      class: 'read',
      description: 'Read a single tracking plan by id, including its event rules.',
      parameters: {
        type: 'object',
        properties: { trackingPlanId: { type: 'string' } },
        required: ['trackingPlanId'],
      },
      request: { method: 'GET', path: '/tracking-plans/{trackingPlanId}' },
    },
    {
      name: 'tracking-plans.create',
      class: 'mutation',
      description: 'Create a new tracking plan.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['LIVE', 'TEMPLATE'], description: 'LIVE plans are enforced; TEMPLATE plans are reusable shells.' },
        },
        required: ['name'],
      },
      request: { method: 'POST', path: '/tracking-plans', body: 'args' },
      cas: 'native-idempotency',
    },
    {
      name: 'tracking-plans.update',
      class: 'mutation',
      description: 'Update the metadata of an existing tracking plan.',
      parameters: {
        type: 'object',
        properties: {
          trackingPlanId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['trackingPlanId'],
      },
      request: {
        method: 'PATCH',
        path: '/tracking-plans/{trackingPlanId}',
        body: { name: '{name}', description: '{description}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'tracking-plans.delete',
      class: 'mutation',
      description: 'Delete a tracking plan.',
      parameters: {
        type: 'object',
        properties: { trackingPlanId: { type: 'string' } },
        required: ['trackingPlanId'],
      },
      request: { method: 'DELETE', path: '/tracking-plans/{trackingPlanId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'audiences.search',
      class: 'read',
      description: 'List Engage / Personas audiences within a Unify space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'Unify (Personas) space id.' },
          pagination: {
            type: 'object',
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 200 },
              cursor: { type: 'string' },
            },
          },
        },
        required: ['spaceId'],
      },
      request: {
        method: 'GET',
        path: '/spaces/{spaceId}/audiences',
        query: { 'pagination.count': '{pagination.count}', 'pagination.cursor': '{pagination.cursor}' },
      },
    },
    {
      name: 'audiences.get',
      class: 'read',
      description: 'Read a single audience definition within a Unify space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          audienceId: { type: 'string' },
        },
        required: ['spaceId', 'audienceId'],
      },
      request: { method: 'GET', path: '/spaces/{spaceId}/audiences/{audienceId}' },
    },
    {
      name: 'audiences.create',
      class: 'mutation',
      description: 'Create a new audience inside a Unify space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          definition: {
            type: 'object',
            description: 'Audience query expressed in Segment FQL (Filter Query Language).',
            properties: {
              query: { type: 'string' },
              type: { type: 'string', enum: ['USERS', 'ACCOUNTS'] },
            },
            required: ['query', 'type'],
          },
        },
        required: ['spaceId', 'name', 'definition'],
      },
      request: {
        method: 'POST',
        path: '/spaces/{spaceId}/audiences',
        body: { name: '{name}', description: '{description}', enabled: '{enabled}', definition: '{definition}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
