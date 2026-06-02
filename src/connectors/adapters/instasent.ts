import { declarativeRestConnector } from './declarative-rest.js'

export const instasentConnector = declarativeRestConnector({
  kind: 'instasent',
  displayName: 'Instasent',
  description: 'Manage contacts and track events in Instasent for audience segmentation and personalized marketing.',
  auth: { kind: 'api-key', hint: 'Instasent API Bearer Token.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.instasent.com/v1',
  test: { method: 'GET', path: '/ping' },
  capabilities: [
    {
      name: 'contacts.add_or_update',
      class: 'mutation',
      description: 'Add or update a contact with properties and optional instant event processing.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasourceId: { type: 'string' },
          userId: { type: 'string' },
          contactProperties: { type: 'object' },
          instant: { type: 'boolean' },
        },
        required: ['projectId', 'datasourceId', 'userId', 'contactProperties'],
      },
      request: {
        method: 'POST',
        path: '/datasources/{datasourceId}/contacts',
        body: {
          userId: '{userId}',
          properties: '{contactProperties}',
          instant: '{instant}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'events.create',
      class: 'mutation',
      description: 'Create an event for a contact with event type and parameters.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasourceId: { type: 'string' },
          userId: { type: 'string' },
          eventId: { type: 'string' },
          eventType: { type: 'string' },
          eventParameters: { type: 'object' },
          eventDate: { type: 'string' },
        },
        required: ['projectId', 'datasourceId', 'userId', 'eventId', 'eventType', 'eventParameters'],
      },
      request: {
        method: 'POST',
        path: '/datasources/{datasourceId}/events',
        body: {
          userId: '{userId}',
          eventId: '{eventId}',
          eventType: '{eventType}',
          eventParameters: '{eventParameters}',
          eventDate: '{eventDate}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'contacts.delete',
      class: 'mutation',
      description: 'Delete a contact from a datasource.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasourceId: { type: 'string' },
          userId: { type: 'string' },
        },
        required: ['projectId', 'datasourceId', 'userId'],
      },
      request: {
        method: 'DELETE',
        path: '/datasources/{datasourceId}/contacts/{userId}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sms.send',
      class: 'mutation',
      description:
        'Send a single SMS message via Instasent. Requires the originator (alphanumeric sender or MSISDN), the recipient MSISDN in E.164 form, and the message body.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description:
              'Originator: alphanumeric sender id (max 11 chars) or sender MSISDN in E.164.',
          },
          to: {
            type: 'string',
            description: 'Recipient MSISDN in E.164 (e.g. +34666112233).',
          },
          text: { type: 'string', description: 'SMS body text.' },
          clientMessageId: {
            type: 'string',
            description:
              'Optional client-supplied message id used for idempotency / dedupe.',
          },
        },
        required: ['from', 'to', 'text'],
      },
      request: {
        method: 'POST',
        path: '/sms/send',
        body: {
          from: '{from}',
          to: '{to}',
          text: '{text}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaign.create',
      class: 'mutation',
      description:
        'Create an SMS campaign targeting a contact segment. The campaign is scheduled for delivery at `scheduledAt` (ISO-8601) or sent immediately if omitted.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign display name.' },
          from: {
            type: 'string',
            description: 'Originator: alphanumeric sender id or sender MSISDN.',
          },
          text: { type: 'string', description: 'Campaign SMS body.' },
          datasourceId: {
            type: 'string',
            description: 'Datasource id whose contacts will receive the campaign.',
          },
          segmentId: {
            type: 'string',
            description:
              'Optional segment id to narrow the recipient set within the datasource.',
          },
          scheduledAt: {
            type: 'string',
            description:
              'Optional ISO-8601 timestamp to schedule delivery; omit to send immediately.',
          },
        },
        required: ['name', 'from', 'text', 'datasourceId'],
      },
      request: {
        method: 'POST',
        path: '/campaigns',
        body: {
          name: '{name}',
          from: '{from}',
          text: '{text}',
          datasourceId: '{datasourceId}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'campaign.cancel',
      class: 'mutation',
      description:
        'Cancel a scheduled SMS campaign. Once a campaign has started delivering, Instasent rejects the cancel; only future-scheduled campaigns can be cancelled.',
      parameters: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign id to cancel.' },
        },
        required: ['campaignId'],
      },
      request: {
        method: 'DELETE',
        path: '/campaigns/{campaignId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
