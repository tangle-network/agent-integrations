import { declarativeRestConnector } from './declarative-rest.js'

export const swarmnodeConnector = declarativeRestConnector({
  kind: 'swarmnode',
  displayName: 'SwarmNode',
  description: 'Execute agents and retrieve execution results from SwarmNode distributed agent infrastructure.',
  auth: { kind: 'api-key', hint: 'SwarmNode API key for agent execution.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.swarmnode.io/v1',
  test: { method: 'GET', path: '/status' },
  capabilities: [
    {
      name: 'execution.get',
      class: 'read',
      description: 'Get the execution status and results of an agent job.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Agent Executor Job ID' },
        },
        required: ['jobId'],
      },
      request: { method: 'GET', path: '/executions/{jobId}' },
    },
    {
      name: 'agent.execute',
      class: 'mutation',
      description: 'Execute an agent with the provided input payload.',
      parameters: {
        type: 'object',
        properties: {
          payload: { type: 'object', description: 'Agent Input Payload' },
        },
        required: ['payload'],
      },
      request: { method: 'POST', path: '/agents/execute', body: '{payload}' },
      cas: 'native-idempotency',
    },
  ],
})
