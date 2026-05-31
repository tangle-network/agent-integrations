import { declarativeRestConnector } from './declarative-rest.js'

export const aianswerConnector = declarativeRestConnector({
  kind: 'aianswer',
  displayName: 'AI Answer',
  description: 'Manage AI Answer agents and phone calls for voice interactions.',
  auth: { kind: 'api-key', hint: 'API key for AI Answer.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.aianswer.com',
  test: { method: 'GET', path: '/v1/agents' },
  capabilities: [
    {
      name: 'agents.list',
      class: 'read',
      description: 'Get a list of available agents.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/v1/agents' },
    },
    {
      name: 'calls.create',
      class: 'mutation',
      description: 'Create a new phone call.',
      parameters: {
        type: 'object',
        properties: {
          agentID: { type: 'string' },
          phoneNumber: { type: 'string' },
          callID: { type: 'string' },
          details: { type: 'object' },
        },
        required: ['agentID', 'phoneNumber', 'callID'],
      },
      request: {
        method: 'POST',
        path: '/v1/calls',
        body: {
          agentID: '{agentID}',
          phoneNumber: '{phoneNumber}',
          callID: '{callID}',
          details: '{details}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Get details of a specific call.',
      parameters: {
        type: 'object',
        properties: { callID: { type: 'string' } },
        required: ['callID'],
      },
      request: { method: 'GET', path: '/v1/calls/{callID}' },
    },
    {
      name: 'calls.schedule',
      class: 'mutation',
      description: 'Schedule a phone call with an agent.',
      parameters: {
        type: 'object',
        properties: {
          agentID: { type: 'string' },
          phoneNumber: { type: 'string' },
          callID: { type: 'string' },
          executionTime: { type: 'string' },
          timezone: { type: 'string' },
          prospectDetails: { type: 'object' },
        },
        required: ['agentID', 'phoneNumber', 'callID', 'executionTime', 'timezone'],
      },
      request: {
        method: 'POST',
        path: '/v1/calls/schedule',
        body: {
          agentID: '{agentID}',
          phoneNumber: '{phoneNumber}',
          callID: '{callID}',
          executionTime: '{executionTime}',
          timezone: '{timezone}',
          prospectDetails: '{prospectDetails}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.transcript',
      class: 'read',
      description: 'Get the transcript of a completed call.',
      parameters: {
        type: 'object',
        properties: { callID: { type: 'string' } },
        required: ['callID'],
      },
      request: { method: 'GET', path: '/v1/calls/{callID}/transcript' },
    },
  ],
})
