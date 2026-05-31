import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Oracle Database adapter.
 *
 * Surfaces Oracle Database operations via SQL/PL-SQL execution,
 * supporting row-level CRUD operations and custom SQL queries.
 *
 * Connection supports both direct (host, port, service name) and
 * connection string configurations. Authentication via username/password.
 * Optional thick mode for legacy Oracle versions (10g, 11g).
 *
 * Operations include:
 * - rows.find: Query rows with optional WHERE conditions
 * - rows.insert: Insert a single row
 * - rows.insertBatch: Insert multiple rows
 * - rows.update: Update rows matching filter conditions
 * - rows.delete: Delete rows matching filter conditions
 * - sql.execute: Run custom SQL or PL/SQL with bind parameters
 */
export const oracleDatabaseConnector = declarativeRestConnector({
  kind: 'oracle-database',
  displayName: 'Oracle Database',
  description: 'Query, insert, update, and delete Oracle Database rows via SQL.',
  auth: { kind: 'api-key', hint: 'Oracle Database connection credentials.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://oracle-api.example.com',
  test: { method: 'POST', path: '/sql/execute' },
  capabilities: [
    {
      name: 'rows.find',
      class: 'read',
      description: 'Query rows from a table with optional WHERE conditions.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name.' },
          filter: { type: 'object', description: 'WHERE conditions (e.g., { "status": "active" }).' },
          columns: { type: 'array', items: { type: 'string' }, description: 'Columns to select.' },
          limit: { type: 'integer', description: 'Maximum rows to return.' },
          orderBy: { type: 'string', description: 'ORDER BY clause.' },
        },
        required: ['table'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: 'SELECT {columns} FROM {table} WHERE {filter} ORDER BY {orderBy} LIMIT {limit}',
          binds: '{filter}',
        },
      },
    },
    {
      name: 'rows.insert',
      class: 'mutation',
      description: 'Insert a single row into a table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name.' },
          row: { type: 'object', description: 'Column names and values to insert.' },
        },
        required: ['table', 'row'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: 'INSERT INTO {table} ({columns}) VALUES ({values})',
          binds: '{row}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.insertBatch',
      class: 'mutation',
      description: 'Insert multiple rows into a table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name.' },
          rows: { type: 'array', items: { type: 'object' }, description: 'Array of row objects.' },
        },
        required: ['table', 'rows'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: 'INSERT INTO {table} ({columns}) VALUES ({values})',
          binds: '{rows}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'rows.update',
      class: 'mutation',
      description: 'Update rows matching filter conditions.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name.' },
          values: { type: 'object', description: 'Column names and new values.' },
          filter: { type: 'object', description: 'WHERE conditions to match rows.' },
        },
        required: ['table', 'values', 'filter'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: 'UPDATE {table} SET {values} WHERE {filter}',
          values: '{values}',
          filter: '{filter}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description: 'Delete rows matching filter conditions.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name.' },
          filter: { type: 'object', description: 'WHERE conditions to match rows for deletion.' },
        },
        required: ['table', 'filter'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: 'DELETE FROM {table} WHERE {filter}',
          binds: '{filter}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'sql.execute',
      class: 'mutation',
      description: 'Run custom SQL or PL/SQL with bind parameters.',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL or PL/SQL to execute. Use :param for bind parameters.' },
          binds: { type: 'object', description: 'Key-value pairs for bind variables.' },
        },
        required: ['sql'],
      },
      request: {
        method: 'POST',
        path: '/sql/execute',
        body: {
          sql: '{sql}',
          binds: '{binds}',
        },
      },
    },
  ],
})
