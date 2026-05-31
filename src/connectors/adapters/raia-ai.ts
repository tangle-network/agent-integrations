import { declarativeRestConnector } from './declarative-rest.js'

export const raiaAiConnector = declarativeRestConnector({
  kind: 'raia-ai',
  displayName: 'Raia AI',
  description: 'Run AI agent workflows with Raia, including prompting agents and uploading agent files.',
  auth: { kind: 'api-key', hint: 'Raia API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.raia.ai/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'agent.prompt',
      class: 'mutation',
      description: 'Run a prompt against an AI agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          prompt: { type: 'string' },
        },
        required: ['agentId', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/agents/{agentId}/prompt',
        body: { prompt: '{prompt}' },
      },
    },
    {
      name: 'agent.file.upload',
      class: 'mutation',
      description: 'Upload a file to an AI agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          file: { type: 'string' },
        },
        required: ['agentId', 'file'],
      },
      request: {
        method: 'POST',
        path: '/agents/{agentId}/files',
        body: { file: '{file}' },
      },
    },
  ],
})
