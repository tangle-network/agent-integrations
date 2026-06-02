import { declarativeRestConnector } from './declarative-rest.js'

export const bolnaConnector = declarativeRestConnector({
  kind: 'bolna',
  displayName: 'Bolna AI',
  description:
    'Place outbound AI voice calls with Bolna agents and inspect agent and call execution history.',
  auth: {
    kind: 'api-key',
    hint: 'Bolna API key, sent as the Authorization: Bearer <key> header.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bolna.dev',
  test: { method: 'GET', path: '/v2/agent/all' },
  capabilities: [
    {
      name: 'agents.list',
      class: 'read',
      description: 'List the Bolna agents available to the current API key.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v2/agent/all' },
    },
    {
      name: 'agents.get',
      class: 'read',
      description: 'Fetch a single Bolna agent by id.',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string' } },
        required: ['agentId'],
      },
      request: { method: 'GET', path: '/v2/agent/{agentId}' },
    },
    {
      name: 'executions.list',
      class: 'read',
      description: 'List recent call executions for a Bolna agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['agentId'],
      },
      request: {
        method: 'GET',
        path: '/agent/{agentId}/executions',
        query: { limit: '{limit}', offset: '{offset}' },
      },
    },
    {
      name: 'executions.get',
      class: 'read',
      description: 'Fetch the result of a single Bolna call execution.',
      parameters: {
        type: 'object',
        properties: { executionId: { type: 'string' } },
        required: ['executionId'],
      },
      request: { method: 'GET', path: '/executions/{executionId}' },
    },
    {
      name: 'calls.cancel',
      class: 'mutation',
      description: 'Cancel a queued or scheduled Bolna voice call by execution id.',
      parameters: {
        type: 'object',
        properties: {
          executionId: {
            type: 'string',
            description: 'Bolna call execution id to cancel.',
          },
        },
        required: ['executionId'],
      },
      request: {
        method: 'DELETE',
        path: '/call/{executionId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'agents.create',
      class: 'mutation',
      description: 'Create a new Bolna voice agent definition.',
      parameters: {
        type: 'object',
        properties: {
          agent_config: {
            type: 'object',
            description: 'Bolna agent configuration (prompts, voice, model, etc.).',
          },
          agent_prompts: {
            type: 'object',
            description: 'Prompt set for the agent (task prompts keyed by task name).',
          },
        },
        required: ['agent_config'],
      },
      request: {
        method: 'POST',
        path: '/v2/agent',
        body: {
          agent_config: '{agent_config}',
          agent_prompts: '{agent_prompts}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'agents.update',
      class: 'mutation',
      description: 'Update an existing Bolna voice agent definition.',
      parameters: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Bolna agent id to update.',
          },
          agent_config: {
            type: 'object',
            description: 'Updated agent configuration.',
          },
          agent_prompts: {
            type: 'object',
            description: 'Updated prompt set for the agent.',
          },
        },
        required: ['agentId'],
      },
      request: {
        method: 'PUT',
        path: '/v2/agent/{agentId}',
        body: {
          agent_config: '{agent_config}',
          agent_prompts: '{agent_prompts}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'agents.delete',
      class: 'mutation',
      description: 'Delete a Bolna voice agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'Bolna agent id to delete.',
          },
        },
        required: ['agentId'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/agent/{agentId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.make',
      class: 'mutation',
      description:
        'Place an outbound AI voice call with a Bolna agent. Maps to the activepieces makePhoneCall action.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            description: 'Bolna agent id that will own the call.',
          },
          recipient_phone_number: {
            type: 'string',
            description: 'Recipient phone number in E.164 format (e.g., +10123456789).',
          },
          from_phone_number: {
            type: 'string',
            description: 'Optional sender phone number in E.164 format.',
          },
          scheduled_at: {
            type: 'string',
            description:
              'Optional ISO 8601 timestamp with time zone at which to place the call (e.g., 2025-08-21T10:35:00Z). Leave empty to call immediately.',
          },
          user_data: {
            type: 'object',
            description: 'Dynamic variables injected into the agent prompt.',
          },
        },
        required: ['agent_id', 'recipient_phone_number'],
      },
      request: {
        method: 'POST',
        path: '/call',
        body: {
          agent_id: '{agent_id}',
          recipient_phone_number: '{recipient_phone_number}',
          from_phone_number: '{from_phone_number}',
          scheduled_at: '{scheduled_at}',
          user_data: '{user_data}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.batch',
      class: 'mutation',
      description:
        'Place a batch of outbound AI voice calls for a single Bolna agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string' },
          recipients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                recipient_phone_number: { type: 'string' },
                user_data: { type: 'object' },
              },
              required: ['recipient_phone_number'],
            },
          },
          from_phone_number: { type: 'string' },
          scheduled_at: { type: 'string' },
        },
        required: ['agent_id', 'recipients'],
      },
      request: {
        method: 'POST',
        path: '/call/batch',
        body: {
          agent_id: '{agent_id}',
          recipients: '{recipients}',
          from_phone_number: '{from_phone_number}',
          scheduled_at: '{scheduled_at}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
