import { declarativeRestConnector } from './declarative-rest.js'

export const openmicAiConnector = declarativeRestConnector({
  kind: 'openmic-ai',
  displayName: 'OpenMic AI',
  description: 'Create and manage phone calls, retrieve bot and call information using OpenMic AI platform.',
  auth: { kind: 'api-key', hint: 'OpenMic AI API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.openmic.ai/v1',
  test: { method: 'GET', path: '/bots' },
  capabilities: [
    {
      name: 'calls.create',
      class: 'mutation',
      description: 'Create a new phone call.',
      parameters: {
        type: 'object',
        properties: {
          fromNumber: { type: 'string', description: 'The number you own in E.164 format (e.g., +1234567890)' },
          toNumber: { type: 'string', description: 'The number to call in E.164 format (e.g., +0987654321)' },
          uid: { type: 'string', description: 'The unique identifier of the bot' },
          overrideAgentId: { type: 'string', description: 'Override agent ID (optional)' },
          customerId: { type: 'string', description: 'Customer identifier for tracking (optional)' },
          dynamicVariables: { type: 'object', description: 'Key-value pairs to replace in the prompt (optional)' },
          callbackUrl: { type: 'string', description: 'Callback URL to receive call events (optional)' },
        },
        required: ['fromNumber', 'toNumber', 'uid'],
      },
      request: {
        method: 'POST',
        path: '/calls',
        body: {
          fromNumber: '{fromNumber}',
          toNumber: '{toNumber}',
          uid: '{uid}',
          overrideAgentId: '{overrideAgentId}',
          customerId: '{customerId}',
          dynamicVariables: '{dynamicVariables}',
          callbackUrl: '{callbackUrl}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bots.list',
      class: 'read',
      description: 'List all bots with optional filtering.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Filter by bot name (partial match)' },
          createdAfter: { type: 'string', description: 'Filter bots created after this date (ISO 8601 format)' },
          createdBefore: { type: 'string', description: 'Filter bots created before this date (ISO 8601 format)' },
          limit: { type: 'integer', description: 'Maximum number of bots to return (1-100)' },
          offset: { type: 'integer', description: 'Number of bots to skip for pagination' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/bots',
        query: {
          name: '{name}',
          createdAfter: '{createdAfter}',
          createdBefore: '{createdBefore}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'bots.find',
      class: 'read',
      description: 'Find a specific bot by ID.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string', description: 'The unique identifier of the bot' },
        },
        required: ['botId'],
      },
      request: {
        method: 'GET',
        path: '/bots/{botId}',
      },
    },
    {
      name: 'calls.list',
      class: 'read',
      description: 'List all calls with optional filtering.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The unique identifier of the call' },
          botId: { type: 'string', description: 'Filter by bot ID' },
          fromDate: { type: 'string', description: 'Filter calls from this date (ISO 8601 format)' },
          toDate: { type: 'string', description: 'Filter calls to this date (ISO 8601 format)' },
          callStatus: { type: 'string', description: 'Filter by call status' },
          callType: { type: 'string', description: 'Filter by call type' },
          limit: { type: 'integer', description: 'Maximum number of calls to return (1-100)' },
          offset: { type: 'integer', description: 'Number of calls to skip for pagination' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/calls',
        query: {
          callId: '{callId}',
          botId: '{botId}',
          fromDate: '{fromDate}',
          toDate: '{toDate}',
          callStatus: '{callStatus}',
          callType: '{callType}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'calls.find',
      class: 'read',
      description: 'Find a specific call by ID.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The unique identifier of the call' },
        },
        required: ['callId'],
      },
      request: {
        method: 'GET',
        path: '/calls/{callId}',
      },
    },
    {
      name: 'bots.create',
      class: 'mutation',
      description: 'Create a new voice bot.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name of the bot' },
          prompt: { type: 'string', description: 'System prompt that drives the bot' },
          voice: { type: 'string', description: 'Voice identifier (optional)' },
          settings: { type: 'object', description: 'Additional bot configuration (optional)' },
        },
        required: ['name', 'prompt'],
      },
      request: {
        method: 'POST',
        path: '/bots',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bots.update',
      class: 'mutation',
      description: 'Update bot prompt, voice, or settings.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string', description: 'The unique identifier of the bot' },
          name: { type: 'string', description: 'Updated display name (optional)' },
          prompt: { type: 'string', description: 'Updated system prompt (optional)' },
          voice: { type: 'string', description: 'Updated voice identifier (optional)' },
          settings: { type: 'object', description: 'Updated bot configuration (optional)' },
        },
        required: ['botId'],
      },
      request: {
        method: 'PATCH',
        path: '/bots/{botId}',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bots.delete',
      class: 'mutation',
      description: 'Delete a bot.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string', description: 'The unique identifier of the bot to delete' },
        },
        required: ['botId'],
      },
      request: {
        method: 'DELETE',
        path: '/bots/{botId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.cancel',
      class: 'mutation',
      description: 'Cancel an outbound call in progress.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The unique identifier of the call to cancel' },
        },
        required: ['callId'],
      },
      request: {
        method: 'POST',
        path: '/calls/{callId}/cancel',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
