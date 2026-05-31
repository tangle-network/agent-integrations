import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Microsoft Excel 365 connector backed by Microsoft Graph v1.0 Excel APIs.
 *
 * Operates on workbooks stored in the signed-in user's OneDrive for Business
 * / SharePoint mailbox. The Graph Excel surface addresses workbooks via drive
 * item id, then exposes named worksheet, table, row, column, and range
 * sub-resources. Authentication uses the Microsoft identity platform v2.0
 * endpoints; the `common` tenant lets a single app registration serve work,
 * school, and personal accounts.
 *
 * Docs:
 *   - https://learn.microsoft.com/graph/api/resources/excel
 *   - https://learn.microsoft.com/graph/api/resources/workbook
 *   - https://learn.microsoft.com/graph/api/resources/worksheet
 *   - https://learn.microsoft.com/graph/api/resources/table
 *   - https://learn.microsoft.com/graph/permissions-reference#files-permissions
 */
export const microsoftExcel365Connector = declarativeRestConnector({
  kind: 'microsoft-excel-365',
  displayName: 'Microsoft Excel 365',
  description:
    'Read and update Excel workbooks, worksheets, tables, ranges, and rows via Microsoft Graph.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['offline_access', 'Files.ReadWrite', 'Sites.ReadWrite.All', 'User.Read'],
    clientIdEnv: 'MS_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
  },
  category: 'spreadsheet',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://graph.microsoft.com/v1.0',
  test: { method: 'GET', path: '/me/drive/root' },
  capabilities: [
    // ---------------- read ----------------
    {
      name: 'get.workbooks',
      class: 'read',
      description:
        'List workbook (.xlsx) drive items in the user OneDrive, optionally narrowing via $search/$filter/$top.',
      parameters: {
        type: 'object',
        properties: {
          $search: { type: 'string' },
          $filter: { type: 'string' },
          $top: { type: 'integer' },
          $select: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/drive/root/search(q={$search})',
        query: { $filter: '{$filter}', $top: '{$top}', $select: '{$select}' },
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'find.workbook',
      class: 'read',
      description: 'Resolve a workbook drive item by exact filename within the user OneDrive root.',
      parameters: {
        type: 'object',
        properties: { fileName: { type: 'string' } },
        required: ['fileName'],
      },
      request: { method: 'GET', path: '/me/drive/root/search(q={fileName})' },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.worksheets',
      class: 'read',
      description: 'List worksheets contained in a workbook.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' } },
        required: ['workbookId'],
      },
      request: { method: 'GET', path: '/me/drive/items/{workbookId}/workbook/worksheets' },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.worksheet',
      class: 'read',
      description: 'Read a single worksheet by id or name within a workbook.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, worksheetId: { type: 'string' } },
        required: ['workbookId', 'worksheetId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}',
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'find.worksheet',
      class: 'read',
      description: 'Locate a worksheet by name within a workbook using OData $filter on name.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, name: { type: 'string' } },
        required: ['workbookId', 'name'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/worksheets',
        query: { $filter: "name eq '{name}'" },
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.worksheet.rows',
      class: 'read',
      description:
        'Read the used range of a worksheet as a row-major value matrix (values only by default).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          valuesOnly: { type: 'boolean' },
        },
        required: ['workbookId', 'worksheetId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/usedRange',
        query: { valuesOnly: '{valuesOnly}' },
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.worksheet.columns',
      class: 'read',
      description: 'Read worksheet columns metadata for a worksheet.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, worksheetId: { type: 'string' } },
        required: ['workbookId', 'worksheetId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/usedRange/columnsAfter',
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.range',
      class: 'read',
      description: 'Read a specific A1-style range from a worksheet (e.g. Sheet1!A1:D10).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'GET',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')",
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.row',
      class: 'read',
      description:
        'Read a single row from a worksheet by 1-based row index (translated to an A1 address on the used range).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'GET',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')",
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'find.row',
      class: 'read',
      description: 'Search a table column for a value, returning the matching row.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          columnId: { type: 'string' },
          value: {},
        },
        required: ['workbookId', 'tableId', 'columnId', 'value'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/columns/{columnId}/range/find',
        body: { text: '{value}', criteria: { completeMatch: true } },
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.table.columns',
      class: 'read',
      description: 'List columns of a table within a workbook.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, tableId: { type: 'string' } },
        required: ['workbookId', 'tableId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/columns',
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'get.table.rows',
      class: 'read',
      description: 'List rows of a table within a workbook (server-paged via $top/$skip).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          $top: { type: 'integer' },
          $skip: { type: 'integer' },
        },
        required: ['workbookId', 'tableId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/rows',
        query: { $top: '{$top}', $skip: '{$skip}' },
      },
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'lookup.table.column',
      class: 'read',
      description: 'Read the data body range of a single table column to drive lookups.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          columnId: { type: 'string' },
        },
        required: ['workbookId', 'tableId', 'columnId'],
      },
      request: {
        method: 'GET',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/columns/{columnId}/dataBodyRange',
      },
      requiredScopes: ['Files.ReadWrite'],
    },

    // ---------------- write ----------------
    {
      name: 'create.workbook',
      class: 'mutation',
      description: 'Create a new empty .xlsx workbook in the user OneDrive root.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string' },
          conflictBehavior: { type: 'string', enum: ['rename', 'replace', 'fail'] },
        },
        required: ['fileName'],
      },
      request: {
        method: 'PUT',
        path: '/me/drive/root:/{fileName}:/content',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'delete.workbook',
      class: 'mutation',
      description: 'Delete a workbook drive item by id.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' } },
        required: ['workbookId'],
      },
      request: { method: 'DELETE', path: '/me/drive/items/{workbookId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'add.worksheet',
      class: 'mutation',
      description: 'Add a new worksheet to a workbook with an optional sheet name.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, name: { type: 'string' } },
        required: ['workbookId'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/add',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'create.worksheet',
      class: 'mutation',
      description: 'Create a worksheet within a workbook (alias of add.worksheet).',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, name: { type: 'string' } },
        required: ['workbookId'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/add',
        body: { name: '{name}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'delete.worksheet',
      class: 'mutation',
      description: 'Delete a worksheet by id or name from a workbook.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, worksheetId: { type: 'string' } },
        required: ['workbookId', 'worksheetId'],
      },
      request: {
        method: 'DELETE',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'rename.worksheet',
      class: 'mutation',
      description: 'Rename a worksheet (PATCH the worksheet name field).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['workbookId', 'worksheetId', 'name'],
      },
      request: {
        method: 'PATCH',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}',
        body: { name: '{name}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'clear.worksheet',
      class: 'mutation',
      description: 'Clear the entire used range of a worksheet (values, formats, or all).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          applyTo: { type: 'string', enum: ['All', 'Formats', 'Contents'] },
        },
        required: ['workbookId', 'worksheetId'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/usedRange/clear',
        body: { applyTo: '{applyTo}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'clear.range',
      class: 'mutation',
      description: 'Clear an A1-style range within a worksheet.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
          applyTo: { type: 'string', enum: ['All', 'Formats', 'Contents'] },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'POST',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')/clear",
        body: { applyTo: '{applyTo}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'clear.column',
      class: 'mutation',
      description: 'Clear an entire column within a worksheet by A1 column address (e.g. B:B).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
          applyTo: { type: 'string', enum: ['All', 'Formats', 'Contents'] },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'POST',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')/clear",
        body: { applyTo: '{applyTo}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'clear.row',
      class: 'mutation',
      description: 'Clear an entire row within a worksheet by A1 row address (e.g. 5:5).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
          applyTo: { type: 'string', enum: ['All', 'Formats', 'Contents'] },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'POST',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')/clear",
        body: { applyTo: '{applyTo}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'delete.row',
      class: 'mutation',
      description: 'Delete a worksheet row by A1 address, shifting cells up.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'POST',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')/delete",
        body: { shift: 'Up' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'append.row',
      class: 'mutation',
      description: 'Append a single row of values to a table within a workbook.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          values: { type: 'array' },
        },
        required: ['workbookId', 'tableId', 'values'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/rows/add',
        body: { values: '{values}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'append.multiple.rows',
      class: 'mutation',
      description: 'Append multiple rows of values to a table in a single batch.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          values: { type: 'array' },
        },
        required: ['workbookId', 'tableId', 'values'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/rows/add',
        body: { values: '{values}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'append.table.rows',
      class: 'mutation',
      description: 'Append rows to a table at a specific index (or end when omitted).',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          tableId: { type: 'string' },
          index: { type: 'integer' },
          values: { type: 'array' },
        },
        required: ['workbookId', 'tableId', 'values'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/rows/add',
        body: { index: '{index}', values: '{values}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'update.row',
      class: 'mutation',
      description: 'Update the values of an existing range within a worksheet.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
          values: { type: 'array' },
        },
        required: ['workbookId', 'worksheetId', 'address', 'values'],
      },
      request: {
        method: 'PATCH',
        path: "/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/range(address='{address}')",
        body: { values: '{values}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'create.table',
      class: 'mutation',
      description:
        'Convert a worksheet range into a table, optionally treating the first row as the header.',
      parameters: {
        type: 'object',
        properties: {
          workbookId: { type: 'string' },
          worksheetId: { type: 'string' },
          address: { type: 'string' },
          hasHeaders: { type: 'boolean' },
        },
        required: ['workbookId', 'worksheetId', 'address'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/worksheets/{worksheetId}/tables/add',
        body: { address: '{address}', hasHeaders: '{hasHeaders}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'delete.table',
      class: 'mutation',
      description: 'Delete a table from a workbook by id or name.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, tableId: { type: 'string' } },
        required: ['workbookId', 'tableId'],
      },
      request: {
        method: 'DELETE',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['Files.ReadWrite'],
    },
    {
      name: 'convert.to.range',
      class: 'mutation',
      description: 'Convert a table back into a normal worksheet range.',
      parameters: {
        type: 'object',
        properties: { workbookId: { type: 'string' }, tableId: { type: 'string' } },
        required: ['workbookId', 'tableId'],
      },
      request: {
        method: 'POST',
        path: '/me/drive/items/{workbookId}/workbook/tables/{tableId}/convertToRange',
      },
      cas: 'native-idempotency',
      requiredScopes: ['Files.ReadWrite'],
    },
  ],
})
