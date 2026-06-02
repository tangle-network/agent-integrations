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
    {
      name: 'datasources.create',
      class: 'mutation',
      description: 'Upload a new datasource to an agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: 'Chaindesk agent id to attach the datasource to.' },
          name: { type: 'string', description: 'Human-readable datasource name.' },
          type: {
            type: 'string',
            description: 'Datasource type (e.g. text, file, web_page, web_site).',
          },
          source: {
            type: 'string',
            description: 'Source content (raw text or URL depending on the type).',
          },
          config: {
            type: 'object',
            description: 'Optional provider-specific config for crawling / chunking.',
          },
        },
        required: ['agentId', 'name', 'type', 'source'],
      },
      request: {
        method: 'POST',
        path: '/datasources',
        body: {
          agentId: '{agentId}',
          name: '{name}',
          type: '{type}',
          source: '{source}',
          config: '{config}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'datasources.delete',
      class: 'mutation',
      description: 'Delete a datasource by id.',
      parameters: {
        type: 'object',
        properties: {
          datasourceId: { type: 'string', description: 'The ID of the datasource to delete.' },
        },
        required: ['datasourceId'],
      },
      request: {
        method: 'DELETE',
        path: '/datasources/{datasourceId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'agents.create',
      class: 'mutation',
      description: 'Create a Chaindesk agent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Agent display name.' },
          description: { type: 'string', description: 'Agent description.' },
          modelName: { type: 'string', description: 'Model identifier the agent uses.' },
          prompt: { type: 'string', description: 'System prompt for the agent.' },
          visibility: {
            type: 'string',
            enum: ['public', 'private'],
            description: 'Agent visibility.',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/agents',
        body: {
          name: '{name}',
          description: '{description}',
          modelName: '{modelName}',
          prompt: '{prompt}',
          visibility: '{visibility}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
