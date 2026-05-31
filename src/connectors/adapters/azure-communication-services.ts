import { declarativeRestConnector } from './declarative-rest.js'

const emailAddress = {
  type: 'object',
  properties: {
    address: { type: 'string' },
    displayName: { type: 'string' },
  },
  required: ['address'],
}

export const azureCommunicationServicesConnector = declarativeRestConnector({
  kind: 'azure-communication-services',
  displayName: 'Azure Communication Services',
  description: 'Send transactional email through the Azure Communication Services Email REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Azure Communication Services connection string (AccessKey). Endpoint is read from the connection string host.',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'endpoint' },
  test: { method: 'GET', path: '/emails/operations?api-version=2023-03-31' },
  capabilities: [
    {
      name: 'send.email',
      class: 'mutation',
      description: 'Send an email via the Azure Communication Services Email API (POST /emails:send).',
      parameters: {
        type: 'object',
        properties: {
          senderAddress: { type: 'string' },
          content: {
            type: 'object',
            properties: {
              subject: { type: 'string' },
              plainText: { type: 'string' },
              html: { type: 'string' },
            },
            required: ['subject'],
          },
          recipients: {
            type: 'object',
            properties: {
              to: { type: 'array', items: emailAddress },
              cc: { type: 'array', items: emailAddress },
              bcc: { type: 'array', items: emailAddress },
            },
            required: ['to'],
          },
          replyTo: { type: 'array', items: emailAddress },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                contentType: { type: 'string' },
                contentInBase64: { type: 'string' },
              },
              required: ['name', 'contentType', 'contentInBase64'],
            },
          },
          headers: { type: 'object' },
          userEngagementTrackingDisabled: { type: 'boolean' },
        },
        required: ['senderAddress', 'content', 'recipients'],
      },
      request: {
        method: 'POST',
        path: '/emails:send?api-version=2023-03-31',
        body: 'args',
      },
      cas: 'native-idempotency',
    },
  ],
})
