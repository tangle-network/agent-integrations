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
    {
      name: 'messages.delete',
      class: 'mutation',
      description: 'Delete a message record (irreversible — purges the message and its body from logs).',
      parameters: {
        type: 'object',
        properties: {
          messageSid: { type: 'string', description: 'The unique identifier of the message (SM…).' },
        },
        required: ['messageSid'],
      },
      request: { method: 'DELETE', path: '/Messages/{messageSid}.json' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.cancel',
      class: 'mutation',
      description: 'Cancel a queued or ringing call by setting its Status to canceled.',
      parameters: {
        type: 'object',
        properties: {
          callSid: { type: 'string', description: 'The unique identifier of the call (CA…).' },
        },
        required: ['callSid'],
      },
      request: {
        method: 'POST',
        path: '/Calls/{callSid}.json',
        body: { Status: 'canceled' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.update',
      class: 'mutation',
      description: 'Update an in-progress call — redirect TwiML, hang up, or mute via the Status field.',
      parameters: {
        type: 'object',
        properties: {
          callSid: { type: 'string', description: 'The unique identifier of the call (CA…).' },
          Url: { type: 'string', description: 'Optional new TwiML URL to redirect the call to.' },
          Method: { type: 'string', enum: ['GET', 'POST'], description: 'HTTP method Twilio uses when fetching the new URL.' },
          Status: { type: 'string', enum: ['canceled', 'completed'], description: 'Set "completed" to hang up an in-progress call.' },
        },
        required: ['callSid'],
      },
      request: {
        method: 'POST',
        path: '/Calls/{callSid}.json',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'numbers.list',
      class: 'read',
      description: 'List IncomingPhoneNumbers on the account.',
      parameters: {
        type: 'object',
        properties: {
          phoneNumber: { type: 'string', description: 'Optional exact-match filter on the E.164 number.' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
        },
      },
      request: {
        method: 'GET',
        path: '/IncomingPhoneNumbers.json',
        query: { PhoneNumber: '{phoneNumber}', PageSize: '{limit}' },
      },
    },
    {
      name: 'numbers.update',
      class: 'mutation',
      description: 'Update an IncomingPhoneNumber configuration (voice/SMS webhook URLs, friendly name).',
      parameters: {
        type: 'object',
        properties: {
          phoneNumberSid: { type: 'string', description: 'The unique identifier of the phone number resource (PN…).' },
          FriendlyName: { type: 'string', description: 'Optional friendly label.' },
          SmsUrl: { type: 'string', description: 'Optional URL Twilio fetches when an SMS comes in.' },
          VoiceUrl: { type: 'string', description: 'Optional URL Twilio fetches when a call comes in.' },
        },
        required: ['phoneNumberSid'],
      },
      request: {
        method: 'POST',
        path: '/IncomingPhoneNumbers/{phoneNumberSid}.json',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
