import { declarativeRestConnector } from './declarative-rest.js'

export const postgresConnector = declarativeRestConnector({
  kind: 'postgres',
  displayName: 'PostgreSQL',
  description: 'Execute queries and monitor PostgreSQL databases.',
  auth: { kind: 'api-key', hint: 'PostgreSQL connection credentials.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'postgresql://',
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'query.execute',
      class: 'read',
      description: 'Execute a SQL query against the database.',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'PostgreSQL server hostname' },
          port: { type: 'integer', description: 'PostgreSQL server port' },
          user: { type: 'string', description: 'Database user' },
          password: { type: 'string', description: 'Database password' },
          database: { type: 'string', description: 'Database name' },
          query: { type: 'string', description: 'SQL query to execute' },
          args: { type: 'array', description: 'Query arguments for parameterized queries' },
          query_timeout: { type: 'integer', description: 'Query timeout in milliseconds' },
          connection_timeout_ms: { type: 'integer', description: 'Connection timeout in milliseconds' },
          application_name: { type: 'string', description: 'Application name for the connection' },
          enable_ssl: { type: 'boolean', description: 'Enable SSL connection' },
          reject_unauthorized: { type: 'boolean', description: 'Verify server certificate' },
          certificate: { type: 'string', description: 'CA certificate for SSL verification' },
        },
        required: ['host', 'port', 'user', 'password', 'database', 'query'],
      },
      request: { method: 'POST', path: '/query', body: '{query}' },
    },
  ],
})
