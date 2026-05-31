import { declarativeRestConnector } from './declarative-rest.js'

export const twilioConnector = declarativeRestConnector({
  kind: 'twilio',
  displayName: 'Twilio',
  description: 'Send SMS messages, make outbound calls, manage messages and recordings.',
  auth: { kind: 'api-key', hint: 'Twilio Account SID and Auth Token (format: AccountSid:AuthToken).' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.twilio.com/2010-04-01/Accounts/{accountSid}',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send an SMS message to a phone number.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format.' },
          from: { type: 'string', description: 'Sender phone number in E.164 format.' },
          body: { type: 'string', description: 'Message body text.' },
        },
        required: ['to', 'from', 'body'],
      },
      request: {
        method: 'POST',
        path: '/Messages.json',
        body: { To: '{to}', From: '{from}', Body: '{body}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.get',
      class: 'read',
      description: 'Retrieve a specific message by SID.',
      parameters: {
        type: 'object',
        properties: {
          messageSid: { type: 'string', description: 'The unique identifier of the message.' },
        },
        required: ['messageSid'],
      },
      request: { method: 'GET', path: '/Messages/{messageSid}.json' },
    },
    {
      name: 'messages.list',
      class: 'read',
      description: 'List messages on the account, optionally filtered by date range.',
      parameters: {
        type: 'object',
        properties: {
          dateSentAfter: { type: 'string', description: 'ISO 8601 date to filter messages sent after.' },
          dateSentBefore: { type: 'string', description: 'ISO 8601 date to filter messages sent before.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
        },
      },
      request: {
        method: 'GET',
        path: '/Messages.json',
        query: { DateSentAfter: '{dateSentAfter}', DateSentBefore: '{dateSentBefore}', PageSize: '{limit}' },
      },
    },
    {
      name: 'calls.make',
      class: 'mutation',
      description: 'Make an outbound call to a phone number.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format.' },
          from: { type: 'string', description: 'Caller phone number in E.164 format.' },
          url: { type: 'string', description: 'URL containing TwiML instructions for the call.' },
          timeout: { type: 'integer', description: 'Timeout in seconds to ring before hanging up.' },
        },
        required: ['to', 'from', 'url'],
      },
      request: {
        method: 'POST',
        path: '/Calls.json',
        body: { To: '{to}', From: '{from}', Url: '{url}', Timeout: '{timeout}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'calls.get',
      class: 'read',
      description: 'Retrieve details of a specific call by SID.',
      parameters: {
        type: 'object',
        properties: {
          callSid: { type: 'string', description: 'The unique identifier of the call.' },
        },
        required: ['callSid'],
      },
      request: { method: 'GET', path: '/Calls/{callSid}.json' },
    },
    {
      name: 'calls.list',
      class: 'read',
      description: 'List calls on the account.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled'],
            description: 'Filter calls by status.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
        },
      },
      request: {
        method: 'GET',
        path: '/Calls.json',
        query: { Status: '{status}', PageSize: '{limit}' },
      },
    },
    {
      name: 'recordings.get',
      class: 'read',
      description: 'Retrieve a recording by SID.',
      parameters: {
        type: 'object',
        properties: {
          recordingSid: { type: 'string', description: 'The unique identifier of the recording.' },
        },
        required: ['recordingSid'],
      },
      request: { method: 'GET', path: '/Recordings/{recordingSid}.json' },
    },
    {
      name: 'recordings.list',
      class: 'read',
      description: 'List recordings on the account.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
        },
      },
      request: {
        method: 'GET',
        path: '/Recordings.json',
        query: { PageSize: '{limit}' },
      },
    },
  ],
})
