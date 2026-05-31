import { declarativeRestConnector } from './declarative-rest.js'

export const smartsheetConnector = declarativeRestConnector({
  kind: 'smartsheet',
  displayName: 'Smartsheet',
  description: 'Manage Smartsheet sheets and rows: find sheets/rows, add/update rows, attach files.',
  auth: { kind: 'api-key', hint: 'Smartsheet API token.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.smartsheet.com/2.0',
  test: { method: 'GET', path: '/user/profile' },
  capabilities: [
    {
      name: 'sheets.search',
      class: 'read',
      description: 'Find a sheet by name.',
      parameters: {
        type: 'object',
        properties: { sheetName: { type: 'string' } },
        required: ['sheetName'],
      },
      request: { method: 'GET', path: '/sheets', query: { includes: 'all' } },
    },
    {
      name: 'rows.search',
      class: 'read',
      description: 'Find rows by query in a sheet.',
      parameters: {
        type: 'object',
        properties: { sheetId: { type: 'string' }, query: { type: 'string' } },
        required: ['sheetId'],
      },
      request: { method: 'GET', path: '/sheets/{sheetId}/rows', query: { include: 'columns,attachments' } },
    },
    {
      name: 'rows.create',
      class: 'mutation',
      description: 'Add a row to a sheet.',
      parameters: {
        type: 'object',
        properties: { sheetId: { type: 'string' }, cells: { type: 'array' }, position: { type: 'string' } },
        required: ['sheetId', 'cells'],
      },
      request: {
        method: 'POST',
        path: '/sheets/{sheetId}/rows',
        body: { rows: [{ cells: '{cells}', position: '{position}' }] },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.update',
      class: 'mutation',
      description: 'Update a row in a sheet.',
      parameters: {
        type: 'object',
        properties: { sheetId: { type: 'string' }, rowId: { type: 'string' }, cells: { type: 'array' } },
        required: ['sheetId', 'rowId', 'cells'],
      },
      request: { method: 'PUT', path: '/sheets/{sheetId}/rows/{rowId}', body: { cells: '{cells}' } },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'attachments.create',
      class: 'mutation',
      description: 'Attach a file to a row.',
      parameters: {
        type: 'object',
        properties: { sheetId: { type: 'string' }, rowId: { type: 'string' }, fileUrl: { type: 'string' }, fileName: { type: 'string' } },
        required: ['sheetId', 'rowId', 'fileUrl'],
      },
      request: { method: 'POST', path: '/sheets/{sheetId}/rows/{rowId}/attachments', query: { url: '{fileUrl}', name: '{fileName}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'attachments.search',
      class: 'read',
      description: 'Find attachments on a row.',
      parameters: {
        type: 'object',
        properties: { sheetId: { type: 'string' }, rowId: { type: 'string' } },
        required: ['sheetId', 'rowId'],
      },
      request: { method: 'GET', path: '/sheets/{sheetId}/rows/{rowId}/attachments' },
    },
  ],
})
