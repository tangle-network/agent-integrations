import { declarativeRestConnector } from './declarative-rest.js'

export const fathomAnalyticsConnector = declarativeRestConnector({
  kind: 'fathom-analytics',
  displayName: 'Fathom Analytics',
  description:
    'Privacy-focused website analytics. Query site traffic, manage sites and events, and generate aggregated reports.',
  auth: { kind: 'api-key', hint: 'Fathom Analytics API token (Bearer).' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.usefathom.com/v1',
  test: { method: 'GET', path: '/sites' },
  capabilities: [
    {
      name: 'list.sites',
      class: 'read',
      description: 'List all sites accessible to the authenticated account.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer' },
          starting_after: { type: 'string' },
          ending_before: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/sites',
        query: {
          limit: '{limit}',
          starting_after: '{starting_after}',
          ending_before: '{ending_before}',
        },
      },
    },
    {
      name: 'get.site',
      class: 'read',
      description: 'Retrieve a single Fathom site by its identifier.',
      parameters: {
        type: 'object',
        properties: { site_id: { type: 'string' } },
        required: ['site_id'],
      },
      request: { method: 'GET', path: '/sites/{site_id}' },
    },
    {
      name: 'create.event',
      class: 'mutation',
      description: 'Create a new event/goal definition on a Fathom site.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['site_id', 'name'],
      },
      request: {
        method: 'POST',
        path: '/sites/{site_id}/events',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'list.events',
      class: 'read',
      description: 'List events/goals defined on a Fathom site.',
      parameters: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          limit: { type: 'integer' },
          starting_after: { type: 'string' },
          ending_before: { type: 'string' },
        },
        required: ['site_id'],
      },
      request: {
        method: 'GET',
        path: '/sites/{site_id}/events',
        query: {
          limit: '{limit}',
          starting_after: '{starting_after}',
          ending_before: '{ending_before}',
        },
      },
    },
    {
      name: 'get.aggregation',
      class: 'read',
      description:
        'Run an aggregation report over pageviews or events with optional grouping, filtering, and sorting.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', enum: ['pageview', 'event'] },
          entity_id: { type: 'string' },
          aggregates: { type: 'string' },
          date_grouping: { type: 'string' },
          field_grouping: { type: 'string' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
          timezone: { type: 'string' },
          sort_by: { type: 'string' },
          limit: { type: 'integer' },
          filters: { type: 'string' },
        },
        required: ['entity', 'entity_id', 'aggregates'],
      },
      request: {
        method: 'GET',
        path: '/aggregations',
        query: {
          entity: '{entity}',
          entity_id: '{entity_id}',
          aggregates: '{aggregates}',
          date_grouping: '{date_grouping}',
          field_grouping: '{field_grouping}',
          date_from: '{date_from}',
          date_to: '{date_to}',
          timezone: '{timezone}',
          sort_by: '{sort_by}',
          limit: '{limit}',
          filters: '{filters}',
        },
      },
    },
  ],
})
