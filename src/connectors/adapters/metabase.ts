import { declarativeRestConnector } from './declarative-rest.js'

export const metabaseConnector = declarativeRestConnector({
  kind: 'metabase',
  displayName: 'Metabase',
  description: 'Query Metabase questions, dashboards, and generate reports with preview rendering.',
  auth: {
    kind: 'api-key',
    hint: 'Metabase API key from settings -> authentication -> API keys',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/api/user/current' },
  capabilities: [
    {
      name: 'questions.get',
      class: 'read',
      description: 'Retrieve a Metabase question (saved query) by ID.',
      parameters: {
        type: 'object',
        properties: { questionId: { type: 'string', description: 'Metabase question ID' } },
        required: ['questionId'],
      },
      request: { method: 'GET', path: '/api/card/{questionId}' },
      requiredScopes: [],
    },
    {
      name: 'questions.preview',
      class: 'read',
      description: 'Get a PNG preview image of a Metabase question.',
      parameters: {
        type: 'object',
        properties: {
          questionId: { type: 'string', description: 'Metabase question ID' },
          waitTime: { type: 'integer', description: 'Seconds to wait for rendering (1-10)', minimum: 1, maximum: 10 },
        },
        required: ['questionId', 'waitTime'],
      },
      request: {
        method: 'GET',
        path: '/api/card/{questionId}/png',
        query: { wait_time: '{waitTime}' },
      },
      requiredScopes: [],
    },
    {
      name: 'dashboards.get_questions',
      class: 'read',
      description: 'Retrieve all questions on a Metabase dashboard.',
      parameters: {
        type: 'object',
        properties: { dashboardId: { type: 'string', description: 'Metabase dashboard ID' } },
        required: ['dashboardId'],
      },
      request: { method: 'GET', path: '/api/dashboard/{dashboardId}' },
      requiredScopes: [],
    },
    {
      name: 'questions.graph_render',
      class: 'read',
      description: 'Get a rendered graph/visualization for a question as PNG.',
      parameters: {
        type: 'object',
        properties: {
          questionId: { type: 'string', description: 'Metabase question ID' },
          graphName: { type: 'string', description: 'Graph name (without file extension)' },
        },
        required: ['questionId', 'graphName'],
      },
      request: {
        method: 'GET',
        path: '/api/card/{questionId}/graph/{graphName}.png',
      },
      requiredScopes: [],
    },
    {
      name: 'questions.embed',
      class: 'mutation',
      description: 'Enable embedding for a question with optional parameters.',
      parameters: {
        type: 'object',
        properties: {
          questionId: { type: 'string', description: 'Metabase question ID' },
          enabled: { type: 'boolean', description: 'Enable or disable embedding' },
          parameters: { type: 'object', description: 'Dashboard parameters to apply (slug -> value)' },
        },
        required: ['questionId', 'enabled'],
      },
      request: {
        method: 'PUT',
        path: '/api/card/{questionId}/embedding',
        body: {
          enabled: '{enabled}',
          cta_enabled: true,
          params: '{parameters}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: [],
    },
  ],
})
