import { declarativeRestConnector } from './declarative-rest.js'

export const chaindeskConnector = declarativeRestConnector({
  kind: 'chaindesk',
  displayName: 'Chaindesk',
  description: 'Query Chaindesk agents and datasources, and upload files.',
  auth: { kind: 'api-key', hint: 'Chaindesk API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.chaindesk.ai/api',
  test: { method: 'GET', path: '/agents' },
  capabilities: [
    {
      name: 'agents.query',
      class: 'read',
      description: 'Query a Chaindesk agent.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The query to send to the agent.' },
          conversationId: {
            type: 'string',
            description: 'ID of the conversation. If not provided, a new conversation is created.',
          },
        },
        required: ['query'],
      },
      request: {
        method: 'POST',
        path: '/agents/{agentId}/query',
        body: { query: '{query}', conversationId: '{conversationId}' },
      },
    },
    {
      name: 'datasources.query',
      class: 'read',
      description: 'Query a Chaindesk datasource.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The query to send to the datasource.' },
          datasourceId: { type: 'string', description: 'The ID of the datasource to query.' },
        },
        required: ['query', 'datasourceId'],
      },
      request: {
        method: 'POST',
        path: '/datasources/{datasourceId}/query',
        body: { query: '{query}' },
      },
    },
    {
      name: 'files.upload',
      class: 'mutation',
      description: 'Upload a file to a Chaindesk datasource.',
      parameters: {
        type: 'object',
        properties: {
          datasourceId: { type: 'string', description: 'The ID of the datasource to upload to.' },
          file: { type: 'string', description: 'The file content (base64 encoded).' },
          filename: {
            type: 'string',
            description: 'The filename for the uploaded file.',
          },
        },
        required: ['datasourceId', 'file'],
      },
      request: {
        method: 'POST',
        path: '/datasources/{datasourceId}/files',
        body: { file: '{file}', filename: '{filename}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
