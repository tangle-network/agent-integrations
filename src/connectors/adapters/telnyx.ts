import { declarativeRestConnector } from './declarative-rest.js'

export const telnyxConnector = declarativeRestConnector({
  kind: 'telnyx',
  displayName: 'Telnyx',
  description: 'Send SMS messages and make voice calls via the Telnyx telecom API platform.',
  auth: { kind: 'api-key', hint: 'Telnyx API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.telnyx.com/v2',
  test: { method: 'GET', path: '/balance' },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send an SMS message.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination phone number or list of numbers.' },
          from: { type: 'string', description: 'Sender phone number in E.164 format.' },
          text: { type: 'string', description: 'Message body.' },
          messaging_profile_id: { type: 'string', description: 'Optional Telnyx messaging profile ID.' },
          webhook_url: { type: 'string', description: 'Optional webhook URL for delivery status.' },
        },
        required: ['to', 'from', 'text'],
      },
      request: {
        method: 'POST',
        path: '/messages',
        body: {
          to: ['{to}'],
          from: '{from}',
          text: '{text}',
          messaging_profile_id: '{messaging_profile_id}',
          webhook_url: '{webhook_url}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.create',
      class: 'mutation',
      description: 'Initiate a voice call.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Destination number or SIP URI.' },
          from: { type: 'string', description: 'Caller ID number in E.164 format.' },
          connection_id: { type: 'string', description: 'Telnyx Call Control Application ID.' },
          audio_url: { type: 'string', description: 'Optional WAV or MP3 URL to play when call is answered.' },
          webhook_url: { type: 'string', description: 'Optional webhook URL for call events.' },
          timeout_secs: { type: 'integer', description: 'Ring timeout in seconds.' },
        },
        required: ['to', 'from', 'connection_id'],
      },
      request: {
        method: 'POST',
        path: '/calls',
        body: {
          to: '{to}',
          from: '{from}',
          connection_id: '{connection_id}',
          audio_url: '{audio_url}',
          webhook_url: '{webhook_url}',
          timeout_secs: '{timeout_secs}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.list',
      class: 'read',
      description: 'List recent calls.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional filter criteria.' },
          page_size: { type: 'integer', description: 'Number of results per page (default 20).' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/calls',
        query: { filter: '{filter}', page_size: '{page_size}' },
      },
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Retrieve call details by ID.',
      parameters: {
        type: 'object',
        properties: {
          call_id: { type: 'string', description: 'Unique call control ID.' },
        },
        required: ['call_id'],
      },
      request: {
        method: 'GET',
        path: '/calls/{call_id}',
      },
    },
    {
      name: 'messages.list',
      class: 'read',
      description: 'List sent or received messages.',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Optional filter criteria.' },
          page_size: { type: 'integer', description: 'Number of results per page.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/messages',
        query: { filter: '{filter}', page_size: '{page_size}' },
      },
    },
  ],
})
