import { declarativeRestConnector } from './declarative-rest.js'

export const contiguityConnector = declarativeRestConnector({
  kind: 'contiguity',
  displayName: 'Contiguity',
  description: 'Send iMessages with optional SMS/RCS fallback via Contiguity API.',
  auth: { kind: 'api-key', hint: 'Contiguity API key from console.contiguity.com/dashboard/tokens' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.contiguity.com/v1',
  test: { method: 'GET', path: '/account' },
  capabilities: [
    {
      name: 'messages.send_text',
      class: 'mutation',
      description: 'Send a text message (SMS/RCS).',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format' },
          from: { type: 'string', description: 'Your leased iMessage number (optional)' },
          message: { type: 'string', description: 'Text message content' },
          fallback: { type: 'boolean', description: 'Enable SMS/RCS fallback (optional)' },
          when: { type: 'string', description: 'Conditions that trigger SMS/RCS fallback (optional)' },
        },
        required: ['to', 'message'],
      },
      request: {
        method: 'POST',
        path: '/messages/send/text',
        body: {
          to: '{to}',
          from: '{from}',
          message: '{message}',
          fallback: '{fallback}',
          when: '{when}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'messages.send_imessage',
      class: 'mutation',
      description: 'Send an iMessage with optional SMS/RCS fallback.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format' },
          from: { type: 'string', description: 'Your leased iMessage number (optional)' },
          message: { type: 'string', description: 'iMessage content' },
          fallback: { type: 'boolean', description: 'Enable SMS/RCS fallback (optional)' },
          when: { type: 'string', description: 'Conditions that trigger SMS/RCS fallback (optional)' },
          attachments: { type: 'object', description: 'File attachments: max 10 files, 50MB total, HTTPS required (optional)' },
        },
        required: ['to', 'message'],
      },
      request: {
        method: 'POST',
        path: '/messages/send/imessage',
        body: {
          to: '{to}',
          from: '{from}',
          message: '{message}',
          fallback: '{fallback}',
          when: '{when}',
          attachments: '{attachments}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
