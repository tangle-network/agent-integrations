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
  ],
})
