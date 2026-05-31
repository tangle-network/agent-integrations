import { declarativeRestConnector } from './declarative-rest.js'

// n8n exposes a first-class REST API at <instance>/api/v1. Auth is a
// long-lived API key sent via the `X-N8N-API-KEY` header (one key per
// account, scoped to the user's role). The instance host is per-connection
// because n8n is typically self-hosted — n8n.cloud customers point at
// https://<workspace>.app.n8n.cloud while self-hosters point at their own
// domain. We model that via metadataKey: 'instanceUrl' so the executor
// resolves the host at call time.

export const n8nConnector = declarativeRestConnector({
  kind: 'n8n',
  displayName: 'n8n',
  description:
    'Run, inspect, and manage n8n workflows against a self-hosted or n8n.cloud instance. Trigger workflows from agents, poll executions, and list workflows.',
  auth: {
    kind: 'api-key',
    hint: 'n8n API key from Settings > API. Sent as `X-N8N-API-KEY: <key>`. The connection also requires the instance URL (e.g. https://workspace.app.n8n.cloud or https://n8n.example.com).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/api/v1/workflows' },
  capabilities: [
    {
      name: 'workflows.list',
      class: 'read',
      description: 'List workflows on the n8n instance. Returns active and inactive workflows.',
      parameters: {
        type: 'object',
        properties: {
          active: { type: 'boolean', description: 'Filter to only active or only inactive workflows.' },
          tags: { type: 'string', description: 'Comma-separated tag names to filter by.' },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          cursor: { type: 'string', description: 'Pagination cursor returned by a prior call.' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/workflows',
        query: { active: '{active}', tags: '{tags}', limit: '{limit}', cursor: '{cursor}' },
      },
    },
    {
      name: 'workflows.get',
      class: 'read',
      description: 'Read a single n8n workflow by id, including its node graph and settings.',
      parameters: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      request: { method: 'GET', path: '/api/v1/workflows/{workflowId}' },
    },
    {
      name: 'workflows.activate',
      class: 'mutation',
      description: 'Activate an n8n workflow so its triggers fire.',
      parameters: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      request: { method: 'POST', path: '/api/v1/workflows/{workflowId}/activate' },
    },
    {
      name: 'workflows.deactivate',
      class: 'mutation',
      description: 'Deactivate an n8n workflow.',
      parameters: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      request: { method: 'POST', path: '/api/v1/workflows/{workflowId}/deactivate' },
    },
    {
      name: 'executions.list',
      class: 'read',
      description:
        'List recent executions across workflows. Filter by workflow id, status, and pagination cursor.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          status: { type: 'string', enum: ['error', 'success', 'waiting'] },
          limit: { type: 'integer', minimum: 1, maximum: 250 },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/api/v1/executions',
        query: {
          workflowId: '{workflowId}',
          status: '{status}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'executions.get',
      class: 'read',
      description:
        'Read a single execution by id, including node outputs and final status. Use this after `workflows.execute` resolves to inspect the run.',
      parameters: {
        type: 'object',
        properties: {
          executionId: { type: 'string' },
          includeData: { type: 'boolean', description: 'Include full node-by-node output payloads.' },
        },
        required: ['executionId'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/executions/{executionId}',
        query: { includeData: '{includeData}' },
      },
    },
    {
      name: 'webhooks.trigger',
      class: 'mutation',
      description:
        'POST a JSON payload to an n8n webhook trigger node. `webhookPath` is the path the workflow registered (e.g. `webhook/my-trigger`). Use this to trigger workflows that start with a Webhook node.',
      parameters: {
        type: 'object',
        properties: {
          webhookPath: { type: 'string' },
          payload: { type: 'object' },
        },
        required: ['webhookPath', 'payload'],
      },
      request: {
        method: 'POST',
        path: '/{webhookPath}',
        body: '{payload}',
      },
    },
  ],
})
