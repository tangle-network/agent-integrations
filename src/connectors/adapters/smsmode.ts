import { declarativeRestConnector } from './declarative-rest.js'

export const smsmodeConnector = declarativeRestConnector({
  kind: 'smsmode',
  displayName: 'SMS Mode',
  description: 'Send and manage SMS messages through the SMS Mode messaging platform.',
  auth: { kind: 'api-key', hint: 'SMS Mode API key.' },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.smsmode.com/v1',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Bearer ' },
  test: { method: 'GET', path: '/accounts' },
  capabilities: [
    {
      name: 'messages.send',
      class: 'mutation',
      description: 'Send an SMS message to a recipient.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number' },
          text: { type: 'string', description: 'Message content' },
        },
        required: ['to', 'text'],
      },
      request: {
        method: 'POST',
        path: '/messages/send',
        body: { to: '{to}', text: '{text}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
