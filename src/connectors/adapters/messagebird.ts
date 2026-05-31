import { declarativeRestConnector } from './declarative-rest.js'

// Bird (formerly MessageBird) SMS API. Channel-scoped messaging lives under
// /workspaces/{workspaceId}/channels/{channelId}/messages — both ids are
// surfaced as capability parameters (the catalog marks them required + secret
// since they identify the tenant's SMS pipe, not the auth principal).
export const messagebirdConnector = declarativeRestConnector({
  kind: 'messagebird',
  displayName: 'Bird',
  description: 'Send SMS messages and list message history via the Bird (MessageBird) channel API.',
  auth: {
    kind: 'api-key',
    hint: 'Bird API Access Key from Settings > Security > Access Keys.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bird.com',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'AccessKey ' },
  test: { method: 'GET', path: '/workspaces/{workspaceId}', query: { workspaceId: '{workspaceId}' } },
  capabilities: [
    {
      name: 'send.sms',
      class: 'mutation',
      description: 'Send an SMS message through a Bird SMS channel.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Bird workspace identifier.' },
          channelId: { type: 'string', description: 'SMS channel identifier within the workspace.' },
          recipient: { type: 'string', description: 'E.164 phone number to send the message to.' },
          message: { type: 'string', description: 'Body of the SMS message.' },
          reference: { type: 'string', description: 'Caller-supplied identifier echoed on delivery receipts.' },
          scheduledFor: {
            type: 'string',
            description: 'ISO-8601 UTC timestamp; omit to send immediately.',
          },
        },
        required: ['workspaceId', 'channelId', 'recipient', 'message'],
      },
      request: {
        method: 'POST',
        path: '/workspaces/{workspaceId}/channels/{channelId}/messages',
        body: {
          receiver: { contacts: [{ identifierValue: '{recipient}' }] },
          body: { type: 'text', text: { text: '{message}' } },
          reference: '{reference}',
          scheduledFor: '{scheduledFor}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'list.messages',
      class: 'read',
      description: 'List messages sent through a Bird SMS channel within a time window.',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: 'Bird workspace identifier.' },
          channelId: { type: 'string', description: 'SMS channel identifier within the workspace.' },
          status: {
            type: 'string',
            description: 'Filter messages by status (e.g. accepted, sent, delivered, failed).',
          },
          startAt: { type: 'string', description: 'ISO-8601 UTC start of the lookup window.' },
          endAt: {
            type: 'string',
            description: 'ISO-8601 UTC end of the lookup window; must be within 7 days of startAt.',
          },
          pageToken: {
            type: 'string',
            description: 'Pagination token returned by a prior page; omit on the first call.',
          },
        },
        required: ['workspaceId', 'channelId', 'status', 'startAt', 'endAt'],
      },
      request: {
        method: 'GET',
        path: '/workspaces/{workspaceId}/channels/{channelId}/messages',
        query: {
          status: '{status}',
          startAt: '{startAt}',
          endAt: '{endAt}',
          pageToken: '{pageToken}',
        },
      },
    },
  ],
})
