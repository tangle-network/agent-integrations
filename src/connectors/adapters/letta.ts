import { declarativeRestConnector } from './declarative-rest.js'

export const lettaConnector = declarativeRestConnector({
  kind: 'letta',
  displayName: 'Letta',
  description: 'Build and manage stateful agents with Letta: create agents from templates, send messages, and manage identities.',
  auth: { kind: 'api-key', hint: 'Letta API key (required for Letta Cloud) or leave empty for self-hosted.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.letta.com' },
  test: { method: 'GET', path: '/v1/agents' },
  capabilities: [
    {
      name: 'agents.create-from-template',
      class: 'mutation',
      description: 'Create an agent from a template.',
      parameters: {
        type: 'object',
        properties: {
          templateVersion: { type: 'string' },
          agentName: { type: 'string' },
          tags: { type: 'object' },
          memoryVariables: { type: 'object' },
          toolVariables: { type: 'object' },
          initialMessageSequence: { type: 'object' },
        },
        required: ['templateVersion'],
      },
      request: {
        method: 'POST',
        path: '/v1/agents',
        body: {
          template_version: '{templateVersion}',
          agent_name: '{agentName}',
          tags: '{tags}',
          memory_variables: '{memoryVariables}',
          tool_variables: '{toolVariables}',
          initial_message_sequence: '{initialMessageSequence}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'agents.list',
      class: 'read',
      description: 'List all agents.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' } },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/agents',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'agents.get',
      class: 'read',
      description: 'Get details of a specific agent.',
      parameters: {
        type: 'object',
        properties: { agentId: { type: 'string' } },
        required: ['agentId'],
      },
      request: {
        method: 'GET',
        path: '/v1/agents/{agentId}',
      },
    },
    {
      name: 'agents.send-message',
      class: 'mutation',
      description: 'Send a message to an agent.',
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          input: { type: 'string' },
          maxSteps: { type: 'integer' },
        },
        required: ['agentId', 'input'],
      },
      request: {
        method: 'POST',
        path: '/v1/agents/{agentId}/messages',
        body: {
          input: '{input}',
          max_steps: '{maxSteps}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'identities.create',
      class: 'mutation',
      description: 'Create an identity for agent interactions.',
      parameters: {
        type: 'object',
        properties: {
          identifierKey: { type: 'string' },
          identityType: { type: 'string' },
          projectId: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['identifierKey', 'identityType'],
      },
      request: {
        method: 'POST',
        path: '/v1/identities',
        body: {
          identifier_key: '{identifierKey}',
          identity_type: '{identityType}',
          project_id: '{projectId}',
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'identities.list',
      class: 'read',
      description: 'List identities.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'integer' } },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/identities',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'identities.get',
      class: 'read',
      description: 'Get details of a specific identity.',
      parameters: {
        type: 'object',
        properties: { identityId: { type: 'string' } },
        required: ['identityId'],
      },
      request: {
        method: 'GET',
        path: '/v1/identities/{identityId}',
      },
    },
  ],
})
