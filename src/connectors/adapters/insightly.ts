import { declarativeRestConnector } from './declarative-rest.js'

// Insightly serves the REST API on a per-account pod (e.g. https://api.na1.insightly.com/v3.1).
// The connection-time `apiUrl` metadata field holds the resolved base URL for the customer's pod;
// callers populate it from the catalog `pod` auth field before invoking any capability.
export const insightlyConnector = declarativeRestConnector({
  kind: 'insightly',
  displayName: 'Insightly',
  description:
    'Manage Insightly CRM records (contacts, leads, opportunities, organisations, projects, tasks) across the Insightly v3.1 REST surface.',
  auth: {
    kind: 'api-key',
    hint: 'Insightly API key from User Settings → API Key. The connection must also store the per-account apiUrl (e.g. https://api.na1.insightly.com/v3.1) derived from the `pod` field.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiUrl' },
  test: { method: 'GET', path: '/Instance' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description:
        'Create a record on a supported Insightly object (Contacts, Leads, Opportunities, Organisations, Projects, Tasks, Events, Notes).',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['objectName', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/{objectName}',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description:
        'Update a record on a supported Insightly object. The body must include the existing primary id field (e.g. CONTACT_ID, LEAD_ID, OPPORTUNITY_ID).',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          fields: { type: 'object' },
        },
        required: ['objectName', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/{objectName}',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Fetch a single record by id from the given Insightly object.',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['objectName', 'recordId'],
      },
      request: {
        method: 'GET',
        path: '/{objectName}/{recordId}',
      },
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record by id from the given Insightly object.',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['objectName', 'recordId'],
      },
      request: {
        method: 'DELETE',
        path: '/{objectName}/{recordId}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.find',
      class: 'read',
      description:
        'Find records on a supported Insightly object by exact field match. Returns up to `top` records (default 100).',
      parameters: {
        type: 'object',
        properties: {
          objectName: { type: 'string' },
          fieldName: { type: 'string' },
          fieldValue: { type: 'string' },
          top: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['objectName', 'fieldName', 'fieldValue'],
      },
      request: {
        method: 'GET',
        path: '/{objectName}/Search',
        query: {
          field_name: '{fieldName}',
          field_value: '{fieldValue}',
          top: '{top}',
        },
      },
    },
    {
      name: 'webhooks.list',
      class: 'read',
      description: 'List webhook subscriptions registered on the Insightly tenant.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: '/WebHooks',
      },
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description:
        'Register a webhook subscription so Insightly notifies the given URL on object events. Used to back the New/Updated/Deleted Record triggers.',
      parameters: {
        type: 'object',
        properties: {
          objectType: { type: 'string' },
          eventType: {
            type: 'string',
            enum: ['Created', 'Updated', 'Deleted'],
          },
          webhookUrl: { type: 'string' },
        },
        required: ['objectType', 'eventType', 'webhookUrl'],
      },
      request: {
        method: 'POST',
        path: '/WebHooks',
        body: {
          OBJECT_TYPE: '{objectType}',
          EVENT_TYPE: '{eventType}',
          URL: '{webhookUrl}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Remove a previously registered webhook by id.',
      parameters: {
        type: 'object',
        properties: {
          webhookId: { type: 'string' },
        },
        required: ['webhookId'],
      },
      request: {
        method: 'DELETE',
        path: '/WebHooks/{webhookId}',
      },
      cas: 'optimistic-read-verify',
    },
  ],
})
