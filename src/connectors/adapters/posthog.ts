import { declarativeRestConnector } from './declarative-rest.js'

export const posthogConnector = declarativeRestConnector({
  kind: 'posthog',
  displayName: 'PostHog',
  description: 'Product analytics: capture events and manage projects in PostHog.',
  auth: {
    kind: 'api-key',
    hint: 'PostHog API key and instance URL. The connection must store apiUrl (e.g. https://app.posthog.com) or your self-hosted instance URL.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'GET', path: '/api/projects' },
  capabilities: [
    {
      name: 'events.create',
      class: 'mutation',
      description: 'Create an event in PostHog.',
      parameters: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            description: 'The event name',
          },
          distinctId: {
            type: 'string',
            description: 'The distinct ID of the user or entity performing the event',
          },
          properties: {
            type: 'object',
            description: 'Event properties',
          },
          timestamp: {
            type: 'string',
            description: 'Event timestamp (ISO 8601 format)',
          },
          context: {
            type: 'object',
            description: 'Additional context for the event',
          },
          messageId: {
            type: 'string',
            description: 'Unique message identifier for idempotency',
          },
        },
        required: ['event', 'distinctId'],
      },
      request: {
        method: 'POST',
        path: '/api/capture',
        body: {
          event: '{event}',
          distinctId: '{distinctId}',
          properties: '{properties}',
          timestamp: '{timestamp}',
          context: '{context}',
          messageId: '{messageId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.create',
      class: 'mutation',
      description: 'Create a new PostHog project.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Project name',
          },
          team: {
            type: 'integer',
            description: 'Team ID',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/api/projects',
        body: {
          name: '{name}',
          team: '{team}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'projects.list',
      class: 'read',
      description: 'List PostHog projects.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/api/projects' },
    },
    {
      name: 'projects.get',
      class: 'read',
      description: 'Get a specific PostHog project by ID.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'Project ID',
          },
        },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/api/projects/{projectId}' },
    },
    {
      name: 'cohorts.list',
      class: 'read',
      description: 'List cohorts in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'Project ID',
          },
        },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/api/projects/{projectId}/cohorts' },
    },
    {
      name: 'feature-flags.list',
      class: 'read',
      description: 'List feature flags in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'Project ID',
          },
        },
        required: ['projectId'],
      },
      request: { method: 'GET', path: '/api/projects/{projectId}/feature_flags' },
    },
    {
      name: 'feature-flags.create',
      class: 'mutation',
      description: 'Create a feature flag in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'Project ID',
          },
          key: {
            type: 'string',
            description: 'Feature flag key',
          },
          name: {
            type: 'string',
            description: 'Feature flag name',
          },
        },
        required: ['projectId', 'key', 'name'],
      },
      request: {
        method: 'POST',
        path: '/api/projects/{projectId}/feature_flags',
        body: {
          key: '{key}',
          name: '{name}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'feature-flags.update',
      class: 'mutation',
      description: 'Update or toggle a feature flag in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          featureFlagId: { type: 'string', description: 'Feature flag ID' },
          key: { type: 'string', description: 'Feature flag key' },
          name: { type: 'string', description: 'Feature flag name' },
          active: { type: 'boolean', description: 'Whether the feature flag is active' },
          filters: { type: 'object', description: 'Targeting filters/conditions' },
          rollout_percentage: { type: 'integer', description: 'Rollout percentage' },
          deleted: { type: 'boolean', description: 'Soft-delete marker' },
        },
        required: ['projectId', 'featureFlagId'],
      },
      request: {
        method: 'PATCH',
        path: '/api/projects/{projectId}/feature_flags/{featureFlagId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'feature-flags.delete',
      class: 'mutation',
      description: 'Delete a feature flag from a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          featureFlagId: { type: 'string', description: 'Feature flag ID' },
        },
        required: ['projectId', 'featureFlagId'],
      },
      request: {
        method: 'DELETE',
        path: '/api/projects/{projectId}/feature_flags/{featureFlagId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'cohorts.create',
      class: 'mutation',
      description: 'Create a new cohort in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Cohort name' },
          description: { type: 'string', description: 'Cohort description' },
          groups: { type: 'array', description: 'Static or dynamic cohort group definitions' },
          is_static: { type: 'boolean', description: 'Whether the cohort is static' },
        },
        required: ['projectId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/api/projects/{projectId}/cohorts',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'annotations.create',
      class: 'mutation',
      description: 'Create a release/event annotation in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          content: { type: 'string', description: 'Annotation content' },
          date_marker: { type: 'string', description: 'ISO 8601 timestamp for the annotation' },
          scope: { type: 'string', description: 'Annotation scope (organization, project, dashboard_item)' },
          dashboard_item: { type: 'integer', description: 'Dashboard item ID when scope is dashboard_item' },
        },
        required: ['projectId', 'content', 'date_marker'],
      },
      request: {
        method: 'POST',
        path: '/api/projects/{projectId}/annotations',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'insights.create',
      class: 'mutation',
      description: 'Create a saved insight/dashboard tile in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Insight name' },
          description: { type: 'string', description: 'Insight description' },
          filters: { type: 'object', description: 'Query filter definition' },
          query: { type: 'object', description: 'HogQL/insight query definition' },
          dashboard: { type: 'integer', description: 'Dashboard ID to attach the insight to' },
          favorited: { type: 'boolean', description: 'Whether to mark the insight as a favorite' },
        },
        required: ['projectId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/api/projects/{projectId}/insights',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
