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
  ],
})
