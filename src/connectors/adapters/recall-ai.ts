import { declarativeRestConnector } from './declarative-rest.js'

export const recallAiConnector = declarativeRestConnector({
  kind: 'recall-ai',
  displayName: 'Recall.ai',
  description: 'Create and manage bots in Zoom, Teams, and other meeting platforms. Send chat messages and retrieve bot status.',
  auth: { kind: 'api-key', hint: 'Recall.ai API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.recall.ai/api/v1',
  test: { method: 'GET', path: '/bots' },
  capabilities: [
    {
      name: 'bots.create',
      class: 'mutation',
      description: 'Create a bot to join a meeting.',
      parameters: {
        type: 'object',
        properties: {
          meeting_url: { type: 'string', description: 'URL of the meeting to join' },
          bot_name: { type: 'string', description: 'Name for the bot (max 100 characters)' },
          recording_config: { type: 'object', description: 'Configuration for recording' },
          output_media: { type: 'object', description: 'Output media configuration' },
          chat: { type: 'object', description: 'Chat configuration' },
          automatic_leave: { type: 'object', description: 'Settings for automatic bot departure' },
          variant: { type: 'object', description: 'Bot variant configuration' },
          breakout_room: { type: 'object', description: 'Breakout room settings' },
          metadata: { type: 'object', description: 'Custom metadata for the bot' },
        },
        required: ['meeting_url'],
      },
      request: {
        method: 'POST',
        path: '/bots',
        body: {
          meeting_url: '{meeting_url}',
          bot_name: '{bot_name}',
          recording_config: '{recording_config}',
          output_media: '{output_media}',
          chat: '{chat}',
          automatic_leave: '{automatic_leave}',
          variant: '{variant}',
          breakout_room: '{breakout_room}',
          metadata: '{metadata}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'bots.retrieve',
      class: 'read',
      description: 'Retrieve the status and details of a bot.',
      parameters: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'UUID of the bot to retrieve' },
        },
        required: ['bot_id'],
      },
      request: {
        method: 'GET',
        path: '/bots/{bot_id}',
      },
    },
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send a chat message in a meeting.',
      parameters: {
        type: 'object',
        properties: {
          bot_id: { type: 'string', description: 'UUID of the bot sending the message' },
          message: { type: 'string', description: 'Message content (max 4096 characters)' },
          to: { type: 'string', description: 'Target recipient (person or group)' },
        },
        required: ['bot_id', 'message'],
      },
      request: {
        method: 'POST',
        path: '/bots/{bot_id}/send_chat_message',
        body: {
          message: '{message}',
          to: '{to}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
