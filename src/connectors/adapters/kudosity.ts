import { declarativeRestConnector } from './declarative-rest.js'

// Kudosity (formerly Transmit SMS) — cloud SMS platform. Mirrors the
// activepieces piece: add/update contact, delete contact, send/cancel SMS,
// format phone number, get message info.
export const kudosityConnector = declarativeRestConnector({
  kind: 'kudosity',
  displayName: 'Kudosity',
  description: 'Send and manage SMS messages and contact lists via the Kudosity (Transmit SMS) API.',
  auth: { kind: 'api-key', hint: 'Kudosity API key. Sent via HTTP Basic auth or as bearer per account settings.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.transmitsms.com',
  test: { method: 'GET', path: '/get-balance.json' },
  capabilities: [
    {
      name: 'contact.add.update',
      class: 'mutation',
      description: 'Add a new contact to a list or update an existing one (matched by msisdn).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Numeric ID of the recipient list.' },
          msisdn: { type: 'string', description: 'Phone number in E.164 (e.g., +1234567890).' },
          email: { type: 'string' },
        },
        required: ['listId', 'msisdn', 'email'],
      },
      request: {
        method: 'POST',
        path: '/add-to-list.json',
        body: {
          list_id: '{listId}',
          msisdn: '{msisdn}',
          email: '{email}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contact.create',
      class: 'mutation',
      description:
        'Create a contact on a Kudosity recipient list. Kudosity upserts by msisdn, so re-issuing with the same number updates the record in place.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Numeric ID of the recipient list.' },
          msisdn: { type: 'string', description: 'Phone number in E.164 format.' },
          email: { type: 'string' },
        },
        required: ['listId', 'msisdn', 'email'],
      },
      request: {
        method: 'POST',
        path: '/add-to-list.json',
        body: {
          list_id: '{listId}',
          msisdn: '{msisdn}',
          email: '{email}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'contact.update',
      class: 'mutation',
      description:
        'Update an existing contact on a Kudosity recipient list, matched by msisdn. Backed by the same add-to-list upsert endpoint.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'Numeric ID of the recipient list the contact belongs to.' },
          msisdn: { type: 'string', description: 'Phone number in E.164 identifying the existing contact.' },
        },
        required: ['listId', 'msisdn'],
      },
      request: {
        method: 'POST',
        path: '/add-to-list.json',
        body: {
          list_id: '{listId}',
          msisdn: '{msisdn}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'contact.delete',
      class: 'mutation',
      description: 'Delete a contact from a recipient list by msisdn.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          msisdn: { type: 'string' },
        },
        required: ['listId', 'msisdn'],
      },
      request: {
        method: 'POST',
        path: '/delete-from-list.json',
        body: { list_id: '{listId}', msisdn: '{msisdn}' },
      },
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description: 'Send an SMS message to a recipient.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Body of the SMS message.' },
          sender: { type: 'string', description: 'Sender ID or virtual number assigned to the account.' },
          recipient: { type: 'string', description: 'Destination number in E.164 or local format.' },
          messageRef: { type: 'string', description: 'Optional reference string for correlation.' },
          trackLinks: { type: 'boolean', description: 'Enable link tracking for this message.' },
        },
        required: ['message', 'sender', 'recipient'],
      },
      request: {
        method: 'POST',
        path: '/send-sms.json',
        body: {
          message: '{message}',
          from: '{sender}',
          to: '{recipient}',
          message_ref: '{messageRef}',
          tracked_links: '{trackLinks}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sms.cancel',
      class: 'mutation',
      description: 'Cancel a scheduled SMS message by its numeric ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Numeric ID assigned to the message sent.' },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/cancel-sms.json',
        body: { message_id: '{id}' },
      },
    },
    {
      name: 'sms.info.get',
      class: 'read',
      description: 'Fetch delivery and metadata for an SMS by message ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Numeric ID assigned to the message sent.' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/get-sms.json',
        query: { message_id: '{id}' },
      },
    },
    {
      name: 'number.format',
      class: 'read',
      description: 'Normalize a phone number to E.164 given a country code.',
      parameters: {
        type: 'object',
        properties: {
          country: { type: 'string', description: 'Country code or name (e.g., US, AU, NZ).' },
          number: { type: 'string', description: 'Phone number in local format.' },
        },
        required: ['country', 'number'],
      },
      request: {
        method: 'GET',
        path: '/format-number.json',
        query: { country: '{country}', msisdn: '{number}' },
      },
    },
  ],
})
