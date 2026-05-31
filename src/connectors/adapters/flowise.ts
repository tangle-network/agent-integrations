import { declarativeRestConnector } from './declarative-rest.js'

// Flowise is self-hosted: the tenant supplies a base URL at credential-mint
// time and we resolve it via metadataKey 'baseUrl'. The activepieces piece
// exposes no canonical SaaS host, so there is no fallback.
export const flowiseConnector = declarativeRestConnector({
  kind: 'flowise',
  displayName: 'Flowise',
  description:
    'Invoke a Flowise chatflow / prediction endpoint on a self-hosted Flowise instance.',
  auth: { kind: 'api-key', hint: 'Flowise API key (sent as Bearer token).' },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: { metadataKey: 'baseUrl' },
  test: { method: 'GET', path: '/api/v1/ping' },
  capabilities: [
    {
      name: 'prediction.invoke',
      class: 'mutation',
      description:
        'Run a Flowise chatflow prediction with a question, optional chat history, and optional overrideConfig.',
      parameters: {
        type: 'object',
        properties: {
          chatflowId: { type: 'string', description: 'Target chatflow id.' },
          question: { type: 'string', description: 'User input / question to run through the chatflow.' },
          history: {
            type: 'array',
            description: 'Prior chat turns to seed the prediction with.',
            items: { type: 'object' },
          },
          overrideConfig: {
            type: 'object',
            description: 'Per-call overrides forwarded to the chatflow runtime.',
          },
        },
        required: ['chatflowId', 'question'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/prediction/{chatflowId}',
        body: {
          question: '{question}',
          history: '{history}',
          overrideConfig: '{overrideConfig}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'chatflows.list',
      class: 'read',
      description: 'List chatflows configured on the Flowise instance.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/api/v1/chatflows' },
    },
    {
      name: 'chatflows.get',
      class: 'read',
      description: 'Fetch a single chatflow definition by id.',
      parameters: {
        type: 'object',
        properties: {
          chatflowId: { type: 'string' },
        },
        required: ['chatflowId'],
      },
      request: { method: 'GET', path: '/api/v1/chatflows/{chatflowId}' },
    },
  ],
})
