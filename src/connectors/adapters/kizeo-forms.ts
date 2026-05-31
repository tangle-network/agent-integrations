import { declarativeRestConnector } from './declarative-rest.js'

// Kizeo Forms REST API v3 — https://www.kizeoforms.com/rest/v3
// The API accepts the per-user API token in the `Authorization` header
// (no scheme prefix). The vendor refers to this as the "user token".
export const kizeoFormsConnector = declarativeRestConnector({
  kind: 'kizeo-forms',
  displayName: 'Kizeo Forms',
  description: 'Create custom mobile forms, manage list items, push data, and export form submissions on Kizeo Forms.',
  auth: { kind: 'api-key', hint: 'Kizeo Forms user token (Authorization header, no scheme).' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.kizeoforms.com/rest/v3',
  credentialPlacement: { kind: 'header', header: 'Authorization' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'create.list.item',
      class: 'mutation',
      description: 'Create a new item in a Kizeo Forms list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string', description: 'ID of the list to add the item to.' },
          itemLabel: { type: 'string', description: 'Label for the new list item.' },
        },
        required: ['listId', 'itemLabel'],
      },
      request: {
        method: 'POST',
        path: '/lists/{listId}/items',
        body: { label: '{itemLabel}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'delete.list.item',
      class: 'mutation',
      description: 'Delete an item from a Kizeo Forms list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          itemId: { type: 'string', description: 'The ID of the item to delete.' },
        },
        required: ['listId', 'itemId'],
      },
      request: { method: 'DELETE', path: '/lists/{listId}/items/{itemId}' },
      cas: 'none',
    },
    {
      name: 'download.custom.export.in.its.original.format',
      class: 'read',
      description: 'Download a custom export of a form submission in its original (vendor-defined) format.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          dataId: { type: 'number' },
          exportId: { type: 'string', description: 'ID of the custom export template.' },
        },
        required: ['formId', 'dataId', 'exportId'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formId}/data/{dataId}/exports/{exportId}',
      },
    },
    {
      name: 'download.standard.pdf',
      class: 'read',
      description: 'Download the standard PDF export of a form submission.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          dataId: { type: 'number' },
          exportInPdf: { type: 'boolean' },
        },
        required: ['formId', 'dataId'],
      },
      request: {
        method: 'GET',
        path: '/forms/{formId}/data/{dataId}/pdf',
        query: { exportInPdf: '{exportInPdf}' },
      },
    },
    {
      name: 'edit.list.item',
      class: 'mutation',
      description: 'Edit an existing item in a Kizeo Forms list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          itemId: { type: 'string' },
          itemLabel: { type: 'string', description: 'New label for the list item.' },
        },
        required: ['listId', 'itemId', 'itemLabel'],
      },
      request: {
        method: 'PUT',
        path: '/lists/{listId}/items/{itemId}',
        body: { label: '{itemLabel}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'get.all.list.items',
      class: 'read',
      description: 'List all items in a Kizeo Forms list with optional search/pagination.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          search: { type: 'string', description: 'Pattern to search.' },
          offset: { type: 'number' },
          limit: { type: 'number', description: 'Max number of results to return.' },
          sort: { type: 'string', description: 'Target for sorting.' },
          direction: { type: 'string', description: 'Sorting: asc or desc.' },
        },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/lists/{listId}/items',
        query: {
          search: '{search}',
          offset: '{offset}',
          limit: '{limit}',
          sort: '{sort}',
          direction: '{direction}',
        },
      },
    },
    {
      name: 'get.data.definition',
      class: 'read',
      description: 'Fetch the field definition (schema) for a form data submission.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/forms/{formId}/data-definition' },
    },
    {
      name: 'get.list.definition',
      class: 'read',
      description: 'Fetch the definition (schema) of a Kizeo Forms list.',
      parameters: {
        type: 'object',
        properties: { listId: { type: 'string' } },
        required: ['listId'],
      },
      request: { method: 'GET', path: '/lists/{listId}' },
    },
    {
      name: 'get.list.item',
      class: 'read',
      description: 'Fetch a single item from a Kizeo Forms list.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          itemId: { type: 'string' },
        },
        required: ['listId', 'itemId'],
      },
      request: { method: 'GET', path: '/lists/{listId}/items/{itemId}' },
    },
    {
      name: 'push.data',
      class: 'mutation',
      description: 'Push a data submission into a Kizeo Forms form (creates form data on the user inbox).',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          recipientUserId: { type: 'number', description: 'ID of the user to deliver the pushed data to.' },
          fields: { type: 'object', description: 'Field values keyed by Kizeo field identifier.' },
        },
        required: ['formId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/forms/{formId}/push',
        body: { recipient_user_id: '{recipientUserId}', fields: '{fields}' },
      },
      cas: 'native-idempotency',
    },
  ],
})
