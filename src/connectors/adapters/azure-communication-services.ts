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
    {
      name: 'send.sms',
      class: 'mutation',
      description:
        'Send an SMS message through the Azure Communication Services SMS API (POST /sms?api-version=2021-03-07).',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'ACS-provisioned sender phone number (E.164).',
          },
          smsRecipients: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                to: { type: 'string' },
                repeatabilityRequestId: { type: 'string' },
                repeatabilityFirstSent: { type: 'string' },
              },
              required: ['to'],
            },
            description: 'Recipient list. Each entry carries an E.164 destination and optional repeatability fields.',
          },
          message: {
            type: 'string',
            description: 'SMS body text. Plain text only; ACS handles GSM7/UCS2 segmentation.',
          },
          smsSendOptions: {
            type: 'object',
            properties: {
              enableDeliveryReport: { type: 'boolean' },
              tag: { type: 'string' },
            },
          },
        },
        required: ['from', 'smsRecipients', 'message'],
      },
      request: {
        method: 'POST',
        path: '/sms?api-version=2021-03-07',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chat.thread.create',
      class: 'mutation',
      description:
        'Create a chat thread for ACS Chat (POST /chat/threads?api-version=2021-09-07). Returns the thread id used by chat.message.send.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'Human-readable thread topic.',
          },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'object',
                  properties: {
                    communicationUser: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                      required: ['id'],
                    },
                  },
                  required: ['communicationUser'],
                },
                displayName: { type: 'string' },
              },
              required: ['id'],
            },
            description: 'Initial participants; each carries an ACS communication user identity.',
          },
        },
        required: ['topic', 'participants'],
      },
      request: {
        method: 'POST',
        path: '/chat/threads?api-version=2021-09-07',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'chat.message.send',
      class: 'mutation',
      description:
        'Post a message to an existing ACS chat thread (POST /chat/threads/{threadId}/messages?api-version=2021-09-07). Pass the full ACS message body as `message`.',
      parameters: {
        type: 'object',
        properties: {
          threadId: {
            type: 'string',
            description: 'Chat thread id (returned by chat.thread.create).',
          },
          message: {
            type: 'object',
            description:
              'ACS message body. Carries `content` (required), and optional `senderDisplayName`, `type` (text|html), and `metadata`.',
            properties: {
              content: { type: 'string' },
              senderDisplayName: { type: 'string' },
              type: { type: 'string', enum: ['text', 'html'] },
              metadata: { type: 'object' },
            },
            required: ['content'],
          },
        },
        required: ['threadId', 'message'],
      },
      request: {
        method: 'POST',
        path: '/chat/threads/{threadId}/messages?api-version=2021-09-07',
        body: '{message}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
