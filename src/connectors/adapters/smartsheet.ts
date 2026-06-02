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
    {
      name: 'sheets.create',
      class: 'mutation',
      description: 'Create a new sheet.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          columns: { type: 'array' },
        },
        required: ['name', 'columns'],
      },
      request: {
        method: 'POST',
        path: '/sheets',
        body: { name: '{name}', columns: '{columns}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description: 'Delete rows by ID.',
      parameters: {
        type: 'object',
        properties: {
          sheetId: { type: 'string' },
          ids: { type: 'string', description: 'Comma-separated row IDs' },
        },
        required: ['sheetId', 'ids'],
      },
      request: {
        method: 'DELETE',
        path: '/sheets/{sheetId}/rows',
        query: { ids: '{ids}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'attachments.delete',
      class: 'mutation',
      description: 'Delete an attachment.',
      parameters: {
        type: 'object',
        properties: {
          sheetId: { type: 'string' },
          attachmentId: { type: 'string' },
        },
        required: ['sheetId', 'attachmentId'],
      },
      request: {
        method: 'DELETE',
        path: '/sheets/{sheetId}/attachments/{attachmentId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'shares.create',
      class: 'mutation',
      description: 'Share a sheet with a user or group.',
      parameters: {
        type: 'object',
        properties: {
          sheetId: { type: 'string' },
          email: { type: 'string' },
          accessLevel: { type: 'string', description: 'VIEWER, EDITOR, EDITOR_SHARE, ADMIN, OWNER' },
        },
        required: ['sheetId', 'email', 'accessLevel'],
      },
      request: {
        method: 'POST',
        path: '/sheets/{sheetId}/shares',
        body: { email: '{email}', accessLevel: '{accessLevel}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Add a comment to a row or sheet (via a discussion).',
      parameters: {
        type: 'object',
        properties: {
          sheetId: { type: 'string' },
          rowId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['sheetId', 'rowId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/sheets/{sheetId}/rows/{rowId}/discussions',
        body: { comment: { text: '{text}' } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
