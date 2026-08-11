import { declarativeRestConnector } from './declarative-rest.js'

export const snowflakeConnector = declarativeRestConnector({
  kind: 'snowflake',
  displayName: 'Snowflake',
  description: 'Execute and monitor SQL statements through a connected Snowflake account SQL API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: '{accountUrl}/oauth/authorize',
    tokenUrl: '{accountUrl}/oauth/token-request',
    scopes: ['refresh_token'],
    clientIdEnv: 'SNOWFLAKE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'SNOWFLAKE_OAUTH_CLIENT_SECRET',
    tokenClientAuthMethod: 'client_secret_post',
    pkce: 'supported',
    urlTemplateMetadata: {
      accountUrl: {
        kind: 'base-url',
        allowedBaseUrlSuffixes: ['.snowflakecomputing.com'],
      },
    },
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'accountUrl' },
  allowedBaseUrlSuffixes: ['.snowflakecomputing.com'],
  defaultHeaders: {
    'content-type': 'application/json',
    'x-snowflake-authorization-token-type': 'OAUTH',
  },
  test: {
    method: 'POST',
    path: '/api/v2/statements',
    body: { statement: 'SELECT CURRENT_ACCOUNT(), CURRENT_USER(), CURRENT_ROLE()' },
  },
  capabilities: [
    {
      name: 'queries.run',
      class: 'mutation',
      description:
        'Execute one SQL statement. Every statement requires approval because Snowflake SQL can mutate account data and configuration.',
      parameters: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'One Snowflake SQL statement.' },
          timeout: { type: 'integer', minimum: 1, description: 'Maximum execution time in seconds.' },
          database: { type: 'string' },
          schema: { type: 'string' },
          warehouse: { type: 'string' },
          role: { type: 'string' },
          bindings: {
            type: 'object',
            description: 'Snowflake SQL API bind variables keyed by one-based position.',
          },
          async: { type: 'boolean', description: 'Return a statement handle without waiting for completion.' },
        },
        required: ['statement'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/statements',
        query: { async: '{async}' },
        body: {
          statement: '{statement}',
          timeout: '{timeout}',
          database: '{database}',
          schema: '{schema}',
          warehouse: '{warehouse}',
          role: '{role}',
          bindings: '{bindings}',
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'queries.runMultiple',
      class: 'mutation',
      description:
        'Execute a semicolon-delimited SQL string as multiple statements. Snowflake does not support bind variables for this operation.',
      parameters: {
        type: 'object',
        properties: {
          statement: { type: 'string', description: 'Semicolon-delimited Snowflake SQL statements.' },
          multiStatementCount: {
            type: 'string',
            pattern: '^[1-9][0-9]*$',
            description: 'Number of statements in the SQL string.',
          },
          timeout: { type: 'integer', minimum: 1 },
          database: { type: 'string' },
          schema: { type: 'string' },
          warehouse: { type: 'string' },
          role: { type: 'string' },
          async: { type: 'boolean' },
        },
        required: ['statement', 'multiStatementCount'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/statements',
        query: { async: '{async}' },
        body: {
          statement: '{statement}',
          timeout: '{timeout}',
          database: '{database}',
          schema: '{schema}',
          warehouse: '{warehouse}',
          role: '{role}',
          parameters: { MULTI_STATEMENT_COUNT: '{multiStatementCount}' },
        },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'statements.get',
      class: 'read',
      description: 'Check a statement and retrieve one result partition.',
      parameters: {
        type: 'object',
        properties: {
          statementHandle: { type: 'string' },
          partition: { type: 'integer', minimum: 0 },
        },
        required: ['statementHandle'],
      },
      request: {
        method: 'GET',
        path: '/api/v2/statements/{statementHandle}',
        query: { partition: '{partition}' },
      },
    },
    {
      name: 'statements.cancel',
      class: 'mutation',
      description: 'Cancel a running SQL statement by its Snowflake handle.',
      parameters: {
        type: 'object',
        properties: { statementHandle: { type: 'string' } },
        required: ['statementHandle'],
      },
      request: {
        method: 'POST',
        path: '/api/v2/statements/{statementHandle}/cancel',
        body: {},
      },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
