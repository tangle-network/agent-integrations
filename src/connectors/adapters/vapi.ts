import { declarativeRestConnector } from './declarative-rest.js'

export const vapiConnector = declarativeRestConnector({
  kind: 'vapi',
  displayName: 'Vapi',
  description: 'AI voice agent platform. Create outbound calls, manage assistants, and retrieve call details.',
  auth: { kind: 'api-key', hint: 'Vapi API key from your Vapi Dashboard.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.vapi.ai',
  test: { method: 'GET', path: '/assistant' },
  capabilities: [
    {
      name: 'calls.create',
      class: 'mutation',
      description: 'Create an outbound call with Vapi.',
      parameters: {
        type: 'object',
        properties: {
          assistantId: { type: 'string', description: 'The ID of the assistant handling the call.' },
          phoneNumberId: { type: 'string', description: 'The ID of the phone number making the call.' },
          customerNumber: { type: 'string', description: 'The phone number to call (E.164 format).' },
          name: { type: 'string', description: 'Optional name for the call.' },
          assistantOverrides: { type: 'object', description: 'Optional assistant configuration overrides.' },
        },
        required: ['assistantId', 'phoneNumberId', 'customerNumber'],
      },
      request: {
        method: 'POST',
        path: '/call',
        body: {
          assistantId: '{assistantId}',
          phoneNumberId: '{phoneNumberId}',
          customerNumber: '{customerNumber}',
          name: '{name}',
          assistantOverrides: '{assistantOverrides}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Retrieve details of a specific call.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The unique identifier of the call.' },
        },
        required: ['callId'],
      },
      request: { method: 'GET', path: '/call/{callId}' },
    },
    {
      name: 'assistants.update',
      class: 'mutation',
      description: 'Update a Vapi assistant configuration.',
      parameters: {
        type: 'object',
        properties: {
          assistantId: { type: 'string', description: 'The ID of the assistant to update.' },
          firstMessage: { type: 'string', description: 'The first message the assistant will say.' },
          instructions: { type: 'string', description: 'System prompt or instructions for the assistant.' },
          model: { type: 'string', description: 'Model name (e.g., gpt-4o).' },
          provider: { type: 'string', description: 'Model provider (e.g., openai).' },
          endCallMessage: { type: 'string', description: 'Message before ending the call.' },
          overrides: { type: 'object', description: 'Additional UpdateAssistantDTO fields.' },
        },
        required: ['assistantId'],
      },
      request: {
        method: 'PATCH',
        path: '/assistant/{assistantId}',
        body: {
          firstMessage: '{firstMessage}',
          instructions: '{instructions}',
          model: '{model}',
          provider: '{provider}',
          endCallMessage: '{endCallMessage}',
          overrides: '{overrides}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'calls.hangup',
      class: 'mutation',
      description: 'End an active Vapi call.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'The unique identifier of the call to end.' },
        },
        required: ['callId'],
      },
      request: {
        method: 'DELETE',
        path: '/call/{callId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assistants.create',
      class: 'mutation',
      description: 'Create a new Vapi voice assistant.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name of the assistant.' },
          firstMessage: { type: 'string', description: 'The first message the assistant will say.' },
          instructions: { type: 'string', description: 'System prompt or instructions for the assistant.' },
          model: { type: 'string', description: 'Model name (e.g., gpt-4o).' },
          provider: { type: 'string', description: 'Model provider (e.g., openai).' },
          endCallMessage: { type: 'string', description: 'Message before ending the call.' },
          overrides: { type: 'object', description: 'Additional CreateAssistantDTO fields.' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/assistant',
        body: {
          name: '{name}',
          firstMessage: '{firstMessage}',
          instructions: '{instructions}',
          model: '{model}',
          provider: '{provider}',
          endCallMessage: '{endCallMessage}',
          overrides: '{overrides}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'assistants.delete',
      class: 'mutation',
      description: 'Delete a Vapi assistant.',
      parameters: {
        type: 'object',
        properties: {
          assistantId: { type: 'string', description: 'The ID of the assistant to delete.' },
        },
        required: ['assistantId'],
      },
      request: {
        method: 'DELETE',
        path: '/assistant/{assistantId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'phone-numbers.list',
      class: 'read',
      description: 'List provisioned Vapi phone numbers.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'Maximum number of phone numbers to return.' },
        },
      },
      request: {
        method: 'GET',
        path: '/phone-number',
        query: { limit: '{limit}' },
      },
    },
  ],
})
