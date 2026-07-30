import { declarativeRestConnector } from './declarative-rest.js'

const recallAiRegions = [
  'https://us-east-1.recall.ai',
  'https://us-west-2.recall.ai',
  'https://eu-central-1.recall.ai',
  'https://ap-northeast-1.recall.ai',
] as const

/** Recall.ai keys are regional and use a raw Authorization header (no Bearer
 * prefix). The server stored on the connection is restricted to Recall's four
 * documented regional hosts so credentials cannot be redirected elsewhere. */
export const recallAiConnector = declarativeRestConnector({
  kind: 'recall-ai',
  displayName: 'Recall.ai',
  description: 'Create meeting bots, inspect bot state, and send in-meeting chat messages.',
  auth: {
    kind: 'api-key',
    hint: 'Recall.ai API key. Select a regional server on the connection; us-east-1 is the default.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'server', fallback: recallAiRegions[0] },
  allowedBaseUrls: recallAiRegions,
  credentialPlacement: { kind: 'header', header: 'Authorization' },
  test: { method: 'GET', path: '/api/v1/bot' },
  capabilities: [
    {
      name: 'bots.create',
      class: 'mutation',
      description: 'Create a Recall.ai bot that joins the supplied meeting URL.',
      parameters: {
        type: 'object',
        properties: {
          meeting_url: { type: 'string', description: 'URL of the meeting to join.' },
          bot_name: { type: 'string', maxLength: 100, description: 'Display name shown in the meeting.' },
        },
        required: ['meeting_url'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/bot/',
        body: {
          meeting_url: '{meeting_url}',
          bot_name: '{bot_name}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'bots.retrieve',
      class: 'read',
      description: 'Retrieve the status and details of a Recall.ai bot.',
      parameters: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'UUID of the bot to retrieve.' },
        },
        required: ['bot_id'],
      },
      request: { method: 'GET', path: '/api/v1/bot/{bot_id}' },
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a chat message from an active Recall.ai bot.',
      parameters: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'UUID of the bot sending the message.' },
          message: { type: 'string', maxLength: 4096 },
          to: { type: 'string', description: 'Recipient; defaults to everyone.' },
          pin: { type: 'boolean', description: 'Pin the message when the meeting platform supports it.' },
        },
        required: ['bot_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/bot/{bot_id}/send_chat_message/',
        body: {
          message: '{message}',
          to: '{to}',
          pin: '{pin}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
