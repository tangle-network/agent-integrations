import { declarativeRestConnector } from './declarative-rest.js'

// Coda exposes a single REST surface rooted at https://coda.io/apis/v1.
// Authentication is a long-lived API token (apiKey credential) issued from
// coda.io/account; the platform passes it as a Bearer header (the
// declarative-rest default).
//
// API reference: https://coda.io/developers/apis/v1
//
// The capability map covers the documents -> tables -> rows hierarchy that
// drives nearly every Coda automation: discover docs, walk tables and columns,
// list/read rows, upsert rows (Coda's native bulk endpoint supports
// keyColumns-based upsert with native idempotency), update a row in place,
// delete a row, and create a new page inside a doc. Formula execution is
// included as a read because it returns a deterministic value derived from the
// doc state at the time of the call.

const docIdParam = {
  type: 'object',
  properties: { docId: { type: 'string' } },
  required: ['docId'],
} as const

const docTableParams = {
  type: 'object',
  properties: {
    docId: { type: 'string' },
    tableIdOrName: { type: 'string' },
  },
  required: ['docId', 'tableIdOrName'],
} as const

const docTableRowParams = {
  type: 'object',
  properties: {
    docId: { type: 'string' },
    tableIdOrName: { type: 'string' },
    rowIdOrName: { type: 'string' },
  },
  required: ['docId', 'tableIdOrName', 'rowIdOrName'],
} as const

export const codaConnector = declarativeRestConnector({
  kind: 'coda',
  displayName: 'Coda',
  description:
    'Read Coda docs and manipulate table rows: list docs, walk tables and columns, upsert and update rows, and create pages.',
  auth: { kind: 'api-key', hint: 'Coda API token from https://coda.io/account.' },
  category: 'spreadsheet',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://coda.io',
  // /whoami returns the token holder's profile and is the canonical health probe.
  test: { method: 'GET', path: '/apis/v1/whoami' },
  capabilities: [
    {
      name: 'account.whoami',
      class: 'read',
      description: 'Return information about the user associated with the API token.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/apis/v1/whoami' },
    },
    {
      name: 'docs.list',
      class: 'read',
      description: 'List Coda docs accessible to the token holder.',
      parameters: {
        type: 'object',
        properties: {
          isOwner: { type: 'boolean' },
          isPublished: { type: 'boolean' },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs',
        query: {
          isOwner: '{isOwner}',
          isPublished: '{isPublished}',
          query: '{query}',
          limit: '{limit}',
          pageToken: '{pageToken}',
        },
      },
    },
    {
      name: 'docs.get',
      class: 'read',
      description: 'Read metadata for a single Coda doc.',
      parameters: docIdParam,
      request: { method: 'GET', path: '/apis/v1/docs/{docId}' },
    },
    {
      name: 'pages.list',
      class: 'read',
      description: 'List pages inside a doc.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
        required: ['docId'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/pages',
        query: { limit: '{limit}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'tables.list',
      class: 'read',
      description: 'List tables and views inside a doc.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableTypes: { type: 'string', description: 'Comma-separated set of table|view.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
        required: ['docId'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/tables',
        query: { tableTypes: '{tableTypes}', limit: '{limit}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'tables.get',
      class: 'read',
      description: 'Read metadata for a specific table or view inside a doc.',
      parameters: docTableParams,
      request: { method: 'GET', path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}' },
    },
    {
      name: 'columns.list',
      class: 'read',
      description: 'List the columns of a table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          visibleOnly: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
        required: ['docId', 'tableIdOrName'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/columns',
        query: { visibleOnly: '{visibleOnly}', limit: '{limit}', pageToken: '{pageToken}' },
      },
    },
    {
      name: 'rows.list',
      class: 'read',
      description: 'List rows from a table or view with optional filtering.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          query: { type: 'string', description: 'Filter expression of form <column>:<value>.' },
          sortBy: { type: 'string', enum: ['createdAt', 'natural', 'updatedAt'] },
          useColumnNames: { type: 'boolean' },
          valueFormat: { type: 'string', enum: ['simple', 'simpleWithArrays', 'rich'] },
          visibleOnly: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          pageToken: { type: 'string' },
          syncToken: { type: 'string' },
        },
        required: ['docId', 'tableIdOrName'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows',
        query: {
          query: '{query}',
          sortBy: '{sortBy}',
          useColumnNames: '{useColumnNames}',
          valueFormat: '{valueFormat}',
          visibleOnly: '{visibleOnly}',
          limit: '{limit}',
          pageToken: '{pageToken}',
          syncToken: '{syncToken}',
        },
      },
    },
    {
      name: 'rows.get',
      class: 'read',
      description: 'Read a single row from a table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          rowIdOrName: { type: 'string' },
          useColumnNames: { type: 'boolean' },
          valueFormat: { type: 'string', enum: ['simple', 'simpleWithArrays', 'rich'] },
        },
        required: ['docId', 'tableIdOrName', 'rowIdOrName'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows/{rowIdOrName}',
        query: { useColumnNames: '{useColumnNames}', valueFormat: '{valueFormat}' },
      },
    },
    {
      name: 'formulas.get',
      class: 'read',
      description: 'Return the computed value of a named formula inside a doc.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          formulaIdOrName: { type: 'string' },
          valueFormat: { type: 'string', enum: ['simple', 'simpleWithArrays', 'rich'] },
        },
        required: ['docId', 'formulaIdOrName'],
      },
      request: {
        method: 'GET',
        path: '/apis/v1/docs/{docId}/formulas/{formulaIdOrName}',
        query: { valueFormat: '{valueFormat}' },
      },
    },
    {
      name: 'rows.upsert',
      class: 'mutation',
      description:
        'Insert or update rows in a table. Pass keyColumns to merge on a natural key; without it every row is appended.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          rows: {
            type: 'array',
            description: 'Each row is { cells: [{ column, value }] }.',
            items: { type: 'object' },
          },
          keyColumns: {
            type: 'array',
            description: 'Column IDs or names that uniquely identify a row for upsert merging.',
            items: { type: 'string' },
          },
          disableParsing: { type: 'boolean' },
        },
        required: ['docId', 'tableIdOrName', 'rows'],
      },
      request: {
        method: 'POST',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows',
        query: { disableParsing: '{disableParsing}' },
        body: { rows: '{rows}', keyColumns: '{keyColumns}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.update',
      class: 'mutation',
      description: 'Update an existing row in a table.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          rowIdOrName: { type: 'string' },
          row: {
            type: 'object',
            description: 'Row payload of shape { cells: [{ column, value }] }.',
          },
          disableParsing: { type: 'boolean' },
        },
        required: ['docId', 'tableIdOrName', 'rowIdOrName', 'row'],
      },
      request: {
        method: 'PUT',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows/{rowIdOrName}',
        query: { disableParsing: '{disableParsing}' },
        body: { row: '{row}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description: 'Delete a row from a table.',
      parameters: docTableRowParams,
      request: {
        method: 'DELETE',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows/{rowIdOrName}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.pushButton',
      class: 'mutation',
      description: 'Trigger a button column on a row, executing the configured action.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          tableIdOrName: { type: 'string' },
          rowIdOrName: { type: 'string' },
          columnIdOrName: { type: 'string' },
        },
        required: ['docId', 'tableIdOrName', 'rowIdOrName', 'columnIdOrName'],
      },
      request: {
        method: 'POST',
        path: '/apis/v1/docs/{docId}/tables/{tableIdOrName}/rows/{rowIdOrName}/buttons/{columnIdOrName}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description: 'Create a new page inside a doc.',
      parameters: {
        type: 'object',
        properties: {
          docId: { type: 'string' },
          name: { type: 'string' },
          subtitle: { type: 'string' },
          iconName: { type: 'string' },
          imageUrl: { type: 'string' },
          parentPageId: { type: 'string' },
          pageContent: {
            type: 'object',
            description: 'Content payload as documented under PageContent in the Coda API reference.',
          },
        },
        required: ['docId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/apis/v1/docs/{docId}/pages',
        body: {
          name: '{name}',
          subtitle: '{subtitle}',
          iconName: '{iconName}',
          imageUrl: '{imageUrl}',
          parentPageId: '{parentPageId}',
          pageContent: '{pageContent}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
