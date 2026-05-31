import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google BigQuery connector — Query, analyze, and stream data into BigQuery
 * via the public bigquery.googleapis.com REST surface.
 *
 * Connection metadata required:
 *   - projectId: the GCP project that owns the dataset.
 *   - datasetId: the dataset (default scope for table-level operations).
 *
 * Authorization: OAuth2 against Google's standard endpoints with the
 * BigQuery read/write scope. Refresh-token flow is handled by the
 * declarative-rest runtime; the catalog's authFields (access_token /
 * refresh_token) map to the oauth2 ConnectorCredentials variant.
 *
 * Capability naming maps onto the activepieces piece's actions:
 *   run.query                 → query.run
 *   create.row / create.rows  → rows.insert.one / rows.insert.many (tabledata.insertAll)
 *   delete.rows               → rows.delete (DML)
 *   update.rows               → rows.update (DML)
 *   find.one.row              → rows.findOne
 *   find.or.create.row        → rows.findOrCreate
 *   get.rows.for.job          → jobs.getQueryResults
 *   import.data               → jobs.load
 *
 * Docs:
 *   - https://cloud.google.com/bigquery/docs/reference/rest
 *   - https://developers.google.com/identity/protocols/oauth2/scopes#bigquery
 */
export const googleBigqueryConnector = declarativeRestConnector({
  kind: 'google-bigquery',
  displayName: 'Google BigQuery',
  description:
    'Query, analyze, and stream data into Google BigQuery — the fully managed, serverless data warehouse.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/bigquery'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://bigquery.googleapis.com/bigquery/v2',
  // Cheap surface that 200s for any token with the BigQuery scope: list
  // datasets in the connection's project.
  test: { method: 'GET', path: '/projects/{projectId}/datasets' },
  capabilities: [
    // ---------- Queries ----------
    {
      name: 'query.run',
      class: 'read',
      description:
        'Run a synchronous SQL query against BigQuery via jobs.query. Returns rows and the underlying jobReference for follow-up paging.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'GCP project to bill the query to.' },
          query: { type: 'string', description: 'Standard SQL (or legacy SQL when useLegacySql=true).' },
          useLegacySql: { type: 'boolean' },
          maxResults: { type: 'integer', minimum: 1, maximum: 100_000 },
          location: { type: 'string' },
          timeoutMs: { type: 'integer', minimum: 0 },
          dryRun: { type: 'boolean' },
          parameterMode: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
          queryParameters: { type: 'array' },
          defaultDataset: { type: 'object' },
        },
        required: ['projectId', 'query'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/queries',
        body: {
          query: '{query}',
          useLegacySql: '{useLegacySql}',
          maxResults: '{maxResults}',
          location: '{location}',
          timeoutMs: '{timeoutMs}',
          dryRun: '{dryRun}',
          parameterMode: '{parameterMode}',
          queryParameters: '{queryParameters}',
          defaultDataset: '{defaultDataset}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'jobs.getQueryResults',
      class: 'read',
      description:
        'Get rows for a previously-submitted query job (paged). Maps to activepieces `get.rows.for.job`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          jobId: { type: 'string' },
          location: { type: 'string' },
          pageToken: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: 100_000 },
          startIndex: { type: 'string' },
          timeoutMs: { type: 'integer' },
        },
        required: ['projectId', 'jobId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/queries/{jobId}',
        query: {
          location: '{location}',
          pageToken: '{pageToken}',
          maxResults: '{maxResults}',
          startIndex: '{startIndex}',
          timeoutMs: '{timeoutMs}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'jobs.get',
      class: 'read',
      description: 'Look up a BigQuery job (status, statistics, errorResult).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          jobId: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['projectId', 'jobId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/jobs/{jobId}',
        query: { location: '{location}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },

    // ---------- Rows (streaming inserts) ----------
    {
      name: 'rows.insert.one',
      class: 'mutation',
      description:
        'Stream a single row into a BigQuery table via tabledata.insertAll. Maps to activepieces `create.row`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          tableId: { type: 'string' },
          row: { type: 'object', description: 'Column→value map for the row.' },
          insertId: { type: 'string', description: 'Client-side dedup key honored by the streaming buffer.' },
          skipInvalidRows: { type: 'boolean' },
          ignoreUnknownValues: { type: 'boolean' },
          templateSuffix: { type: 'string' },
        },
        required: ['projectId', 'datasetId', 'tableId', 'row'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/datasets/{datasetId}/tables/{tableId}/insertAll',
        body: {
          rows: [{ insertId: '{insertId}', json: '{row}' }],
          skipInvalidRows: '{skipInvalidRows}',
          ignoreUnknownValues: '{ignoreUnknownValues}',
          templateSuffix: '{templateSuffix}',
        },
      },
      // insertId is BigQuery's documented dedup token for streaming inserts.
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'rows.insert.many',
      class: 'mutation',
      description:
        'Stream a batch of rows into a BigQuery table via tabledata.insertAll. Maps to activepieces `create.rows`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          tableId: { type: 'string' },
          rows: {
            type: 'array',
            description: 'Array of {insertId?, json} entries. Each entry is one row.',
            items: { type: 'object' },
          },
          skipInvalidRows: { type: 'boolean' },
          ignoreUnknownValues: { type: 'boolean' },
          templateSuffix: { type: 'string' },
        },
        required: ['projectId', 'datasetId', 'tableId', 'rows'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/datasets/{datasetId}/tables/{tableId}/insertAll',
        body: {
          rows: '{rows}',
          skipInvalidRows: '{skipInvalidRows}',
          ignoreUnknownValues: '{ignoreUnknownValues}',
          templateSuffix: '{templateSuffix}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },

    // ---------- Row finders ----------
    {
      name: 'rows.findOne',
      class: 'read',
      description:
        'Find a single row matching a SQL predicate. Maps to activepieces `find.one.row`; executes via jobs.query with LIMIT 1.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          query: { type: 'string', description: 'A SELECT ... LIMIT 1 SQL statement.' },
          useLegacySql: { type: 'boolean' },
          location: { type: 'string' },
          queryParameters: { type: 'array' },
          parameterMode: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
        },
        required: ['projectId', 'query'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/queries',
        body: {
          query: '{query}',
          useLegacySql: '{useLegacySql}',
          maxResults: 1,
          location: '{location}',
          queryParameters: '{queryParameters}',
          parameterMode: '{parameterMode}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'rows.findOrCreate',
      class: 'mutation',
      description:
        'Find a row by predicate, otherwise stream-insert it. Maps to activepieces `find.or.create.row`. Implemented as a MERGE statement via jobs.query so the find + insert run as a single BigQuery job.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          tableId: { type: 'string' },
          mergeSql: {
            type: 'string',
            description:
              'A full MERGE statement of the form: MERGE `dataset.table` T USING (SELECT @v1 AS col1, ...) S ON T.key = S.key WHEN NOT MATCHED THEN INSERT (...) VALUES (...).',
          },
          queryParameters: { type: 'array' },
          parameterMode: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
          location: { type: 'string' },
        },
        required: ['projectId', 'datasetId', 'tableId', 'mergeSql'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/queries',
        body: {
          query: '{mergeSql}',
          useLegacySql: false,
          queryParameters: '{queryParameters}',
          parameterMode: '{parameterMode}',
          location: '{location}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },

    // ---------- Row mutations (DML via jobs.query) ----------
    {
      name: 'rows.update',
      class: 'mutation',
      description:
        'Update rows in a BigQuery table by running a DML UPDATE through jobs.query. Maps to activepieces `update.rows`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          updateSql: {
            type: 'string',
            description: 'A full UPDATE `dataset.table` SET ... WHERE ... statement.',
          },
          queryParameters: { type: 'array' },
          parameterMode: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
          location: { type: 'string' },
        },
        required: ['projectId', 'updateSql'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/queries',
        body: {
          query: '{updateSql}',
          useLegacySql: false,
          queryParameters: '{queryParameters}',
          parameterMode: '{parameterMode}',
          location: '{location}',
        },
      },
      // BigQuery DML is statement-scoped; re-running the same statement after
      // a network failure is what the caller has to decide. Mark as
      // optimistic-read-verify so the orchestrator re-reads before retry.
      cas: 'optimistic-read-verify',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'rows.delete',
      class: 'mutation',
      description:
        'Delete rows from a BigQuery table by running a DML DELETE through jobs.query. Maps to activepieces `delete.rows`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          deleteSql: {
            type: 'string',
            description: 'A full DELETE FROM `dataset.table` WHERE ... statement.',
          },
          queryParameters: { type: 'array' },
          parameterMode: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
          location: { type: 'string' },
        },
        required: ['projectId', 'deleteSql'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/queries',
        body: {
          query: '{deleteSql}',
          useLegacySql: false,
          queryParameters: '{queryParameters}',
          parameterMode: '{parameterMode}',
          location: '{location}',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },

    // ---------- Load jobs ----------
    {
      name: 'data.import',
      class: 'mutation',
      description:
        'Submit a load job that imports data from GCS (or inline source URIs) into a BigQuery table. Maps to activepieces `import.data`.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          tableId: { type: 'string' },
          sourceUris: { type: 'array', items: { type: 'string' } },
          sourceFormat: {
            type: 'string',
            enum: ['CSV', 'NEWLINE_DELIMITED_JSON', 'AVRO', 'PARQUET', 'ORC'],
          },
          writeDisposition: {
            type: 'string',
            enum: ['WRITE_APPEND', 'WRITE_TRUNCATE', 'WRITE_EMPTY'],
          },
          createDisposition: {
            type: 'string',
            enum: ['CREATE_IF_NEEDED', 'CREATE_NEVER'],
          },
          schema: { type: 'object' },
          autodetect: { type: 'boolean' },
          skipLeadingRows: { type: 'integer' },
          location: { type: 'string' },
        },
        required: ['projectId', 'datasetId', 'tableId', 'sourceUris', 'sourceFormat'],
      },
      request: {
        method: 'POST',
        path: '/projects/{projectId}/jobs',
        body: {
          jobReference: { projectId: '{projectId}', location: '{location}' },
          configuration: {
            load: {
              sourceUris: '{sourceUris}',
              sourceFormat: '{sourceFormat}',
              destinationTable: {
                projectId: '{projectId}',
                datasetId: '{datasetId}',
                tableId: '{tableId}',
              },
              writeDisposition: '{writeDisposition}',
              createDisposition: '{createDisposition}',
              schema: '{schema}',
              autodetect: '{autodetect}',
              skipLeadingRows: '{skipLeadingRows}',
            },
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },

    // ---------- Dataset + table discovery ----------
    {
      name: 'datasets.list',
      class: 'read',
      description: 'List datasets in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          pageToken: { type: 'string' },
          maxResults: { type: 'integer' },
          all: { type: 'boolean' },
        },
        required: ['projectId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/datasets',
        query: { pageToken: '{pageToken}', maxResults: '{maxResults}', all: '{all}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'tables.list',
      class: 'read',
      description: 'List tables in a dataset.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          pageToken: { type: 'string' },
          maxResults: { type: 'integer' },
        },
        required: ['projectId', 'datasetId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/datasets/{datasetId}/tables',
        query: { pageToken: '{pageToken}', maxResults: '{maxResults}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
    {
      name: 'tables.get',
      class: 'read',
      description: 'Read a table resource (schema, partitioning, row counts).',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          datasetId: { type: 'string' },
          tableId: { type: 'string' },
        },
        required: ['projectId', 'datasetId', 'tableId'],
      },
      request: {
        method: 'GET',
        path: '/projects/{projectId}/datasets/{datasetId}/tables/{tableId}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/bigquery'],
    },
  ],
})
