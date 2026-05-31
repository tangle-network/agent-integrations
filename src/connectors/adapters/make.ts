import { declarativeRestConnector } from './declarative-rest.js'

// Make.com (formerly Integromat) exposes its REST API at the regional zone
// host the workspace lives in (https://eu1.make.com, https://us1.make.com,
// etc.). Auth is a bearer token created in Profile > API. The customer
// supplies their zone host plus their teamId / organizationId per call.
//
// For agent-side automation the most useful surfaces are:
//   - scenarios.run     — kick off a scenario manually
//   - scenarios.list    — discover what scenarios exist
//   - executions.get    — poll for completion + status
//   - hooks.trigger     — POST to a per-scenario "Custom Webhook" trigger

export const makeConnector = declarativeRestConnector({
  kind: 'make',
  displayName: 'Make',
  description:
    'Run Make (Integromat) scenarios, inspect executions, and POST payloads to scenario webhooks.',
  auth: {
    kind: 'api-key',
    hint: 'Make API token from Profile > API. Sent as `Authorization: Token <token>`. Connection also requires the zone host (https://eu1.make.com, https://us1.make.com, etc.) and the teamId.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: { metadataKey: 'zoneUrl' },
  test: { method: 'GET', path: '/api/v2/users/me' },
  capabilities: [
    {
      name: 'scenarios.list',
      class: 'read',
      description: 'List scenarios in a Make team. teamId is required by the API.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string' },
          organizationId: { type: 'string' },
          pg: {
            type: 'object',
            description:
              'Pagination object; use {"sortBy":"name","limit":50,"offset":0}.',
          },
        },
        required: ['teamId'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/scenarios',
        query: { teamId: '{teamId}', organizationId: '{organizationId}', pg: '{pg}' },
      },
    },
    {
      name: 'scenarios.get',
      class: 'read',
      description: 'Read a single Make scenario by id.',
      parameters: {
        type: 'object',
        properties: { scenarioId: { type: 'string' } },
        required: ['scenarioId'],
      },
      request: { method: 'GET', path: '/api/v2/scenarios/{scenarioId}' },
    },
    {
      name: 'scenarios.run',
      class: 'mutation',
      description:
        'Manually run a Make scenario. `data` is optional input that flows into the scenario as the trigger bundle.',
      parameters: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string' },
          data: { type: 'object', description: 'Optional trigger bundle.' },
          responsive: {
            type: 'boolean',
            description:
              'When true, the request waits for the scenario to finish and returns the result inline. When false (default), the call returns an execution id and the agent polls executions.get.',
          },
        },
        required: ['scenarioId'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/scenarios/{scenarioId}/run',
        body: { data: '{data}', responsive: '{responsive}' },
      },
    },
    {
      name: 'scenarios.activate',
      class: 'mutation',
      description: 'Activate a Make scenario so its trigger schedule fires.',
      parameters: {
        type: 'object',
        properties: { scenarioId: { type: 'string' } },
        required: ['scenarioId'],
      },
      request: { method: 'POST', path: '/api/v2/scenarios/{scenarioId}/start' },
    },
    {
      name: 'scenarios.deactivate',
      class: 'mutation',
      description: 'Deactivate a Make scenario.',
      parameters: {
        type: 'object',
        properties: { scenarioId: { type: 'string' } },
        required: ['scenarioId'],
      },
      request: { method: 'POST', path: '/api/v2/scenarios/{scenarioId}/stop' },
    },
    {
      name: 'executions.list',
      class: 'read',
      description: 'List executions for a scenario.',
      parameters: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string' },
          pg: { type: 'object', description: 'Pagination object.' },
        },
        required: ['scenarioId'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/scenarios/{scenarioId}/executions',
        query: { pg: '{pg}' },
      },
    },
    {
      name: 'executions.get',
      class: 'read',
      description: 'Read a single execution by id, including status and node outputs.',
      parameters: {
        type: 'object',
        properties: {
          scenarioId: { type: 'string' },
          executionId: { type: 'string' },
        },
        required: ['scenarioId', 'executionId'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/scenarios/{scenarioId}/executions/{executionId}',
      },
    },
    {
      name: 'hooks.trigger',
      class: 'mutation',
      description:
        'POST a payload to a Make scenario "Custom Webhook" trigger URL. `hookId` is the unique hook segment from the webhook URL (the host is set by the connection).',
      parameters: {
        type: 'object',
        properties: {
          hookId: { type: 'string' },
          payload: { type: 'object' },
        },
        required: ['hookId', 'payload'],
      },
      request: {
        method: 'POST',
        path: '/hooks/{hookId}',
        body: '{payload}',
      },
    },
  ],
})
