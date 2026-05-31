import { declarativeRestConnector } from './declarative-rest.js'

// Pipedream exposes a REST API at https://api.pipedream.com/v1 and a per-
// workflow HTTP-source URL pattern at <endpoint>.m.pipedream.net. The REST
// API uses an OAuth-style bearer token from Pipedream account settings. We
// model both surfaces — REST for management/observation and the source URL
// pattern for trigger ingress.

export const pipedreamConnector = declarativeRestConnector({
  kind: 'pipedream',
  displayName: 'Pipedream',
  description:
    'Manage Pipedream workflows and sources, list events, and POST payloads to HTTP-source workflow URLs.',
  auth: {
    kind: 'api-key',
    hint: 'Pipedream API key from Account Settings > API. Sent as `Authorization: Bearer <key>`.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://api.pipedream.com/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'workflows.list',
      class: 'read',
      description:
        'List workflows owned by the authenticated account or a specific organization workspace.',
      parameters: {
        type: 'object',
        properties: {
          orgId: { type: 'string', description: 'Optional organization workspace id.' },
        },
      },
      request: {
        method: 'GET',
        path: '/workflows',
        query: { org_id: '{orgId}' },
      },
    },
    {
      name: 'workflows.get',
      class: 'read',
      description: 'Read a Pipedream workflow by id, including its source endpoints.',
      parameters: {
        type: 'object',
        properties: { workflowId: { type: 'string' } },
        required: ['workflowId'],
      },
      request: { method: 'GET', path: '/workflows/{workflowId}' },
    },
    {
      name: 'sources.list',
      class: 'read',
      description: 'List event sources (the trigger half of a workflow).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/sources' },
    },
    {
      name: 'sources.events',
      class: 'read',
      description:
        'Read recent events emitted by a Pipedream source. Useful for polling without subscribing.',
      parameters: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['sourceId'],
      },
      request: {
        method: 'GET',
        path: '/sources/{sourceId}/event_summaries',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'http.trigger',
      class: 'mutation',
      description:
        'POST a JSON payload to a Pipedream HTTP-source workflow URL. `endpointUrl` is the full https://<id>.m.pipedream.net URL the workflow published; the body becomes the trigger event.',
      parameters: {
        type: 'object',
        properties: {
          endpointUrl: { type: 'string' },
          payload: { type: 'object' },
        },
        required: ['endpointUrl', 'payload'],
      },
      request: {
        method: 'POST',
        path: '{endpointUrl}',
        body: '{payload}',
      },
    },
    {
      name: 'subscriptions.create',
      class: 'mutation',
      description:
        'Subscribe an emitting source/workflow to a listener so its events fan out to another workflow.',
      parameters: {
        type: 'object',
        properties: {
          emitterId: { type: 'string' },
          listenerId: { type: 'string' },
          eventName: { type: 'string' },
        },
        required: ['emitterId', 'listenerId'],
      },
      request: {
        method: 'POST',
        path: '/subscriptions',
        body: {
          emitter_id: '{emitterId}',
          listener_id: '{listenerId}',
          event_name: '{eventName}',
        },
      },
    },
  ],
})
