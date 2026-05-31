import { declarativeRestConnector } from './declarative-rest.js'

/**
 * MongoDB adapter.
 *
 * Surfaces MongoDB document operations via the MongoDB Data API
 * (https://www.mongodb.com/docs/atlas/api/data-api/).
 *
 * Requires MongoDB Atlas and Data API enabled. Connection is via
 * API key authentication with host, database, and optional auth
 * credentials configured.
 *
 * Operations include:
 * - documents.find: Query documents with optional filters, projections, sort, limit, skip
 * - documents.findOne: Find a single document matching a filter
 * - documents.insertOne: Insert a single document into a collection
 * - documents.insertMany: Insert multiple documents
 * - documents.updateOne: Update a single document matching a filter
 * - documents.updateMany: Update multiple documents matching a filter
 * - documents.replaceOne: Replace a single document entirely
 * - documents.deleteOne: Delete a single document matching a filter
 * - documents.deleteMany: Delete multiple documents matching a filter
 * - documents.aggregate: Run an aggregation pipeline over a collection
 */
export const mongodbConnector = declarativeRestConnector({
  kind: 'mongodb',
  displayName: 'MongoDB',
  description: 'Query, insert, update, and delete MongoDB documents via the Data API.',
  auth: { kind: 'api-key', hint: 'MongoDB Data API key.' },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://data.mongodb-api.com/app',
  test: { method: 'POST', path: '/{appId}/endpoint/data/v1/action/findOne' },
  capabilities: [
    {
      name: 'documents.find',
      class: 'read',
      description: 'Query documents in a collection.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name (e.g., "Cluster0").' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter (e.g., { "status": "active" }).' },
          projection: { type: 'object', description: 'Fields to include/exclude.' },
          sort: { type: 'object', description: 'Sort criteria.' },
          limit: { type: 'integer', description: 'Maximum documents to return.' },
          skip: { type: 'integer', description: 'Documents to skip.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/find',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
          projection: '{projection}',
          sort: '{sort}',
          limit: '{limit}',
          skip: '{skip}',
        },
      },
    },
    {
      name: 'documents.findOne',
      class: 'read',
      description: 'Find a single document matching a filter.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
          projection: { type: 'object', description: 'Fields to include/exclude.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/findOne',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
          projection: '{projection}',
        },
      },
    },
    {
      name: 'documents.insertOne',
      class: 'mutation',
      description: 'Insert a single document into a collection.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          document: { type: 'object', description: 'Document to insert.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'document'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/insertOne',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          document: '{document}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.insertMany',
      class: 'mutation',
      description: 'Insert multiple documents into a collection.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          documents: { type: 'array', items: { type: 'object' }, description: 'Array of documents to insert.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'documents'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/insertMany',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          documents: '{documents}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.updateOne',
      class: 'mutation',
      description: 'Update a single document matching a filter.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
          update: { type: 'object', description: 'Update operations (e.g., { "$set": { "status": "inactive" } }).' },
          upsert: { type: 'boolean', description: 'Insert if no match found.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'filter', 'update'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/updateOne',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
          update: '{update}',
          upsert: '{upsert}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'documents.updateMany',
      class: 'mutation',
      description: 'Update multiple documents matching a filter.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
          update: { type: 'object', description: 'Update operations.' },
          upsert: { type: 'boolean', description: 'Insert if no match found.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'filter', 'update'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/updateMany',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
          update: '{update}',
          upsert: '{upsert}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'documents.replaceOne',
      class: 'mutation',
      description: 'Replace a single document entirely.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
          replacement: { type: 'object', description: 'Replacement document.' },
          upsert: { type: 'boolean', description: 'Insert if no match found.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'filter', 'replacement'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/replaceOne',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
          replacement: '{replacement}',
          upsert: '{upsert}',
        },
      },
      cas: 'etag-if-match',
    },
    {
      name: 'documents.deleteOne',
      class: 'mutation',
      description: 'Delete a single document matching a filter.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'filter'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/deleteOne',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.deleteMany',
      class: 'mutation',
      description: 'Delete multiple documents matching a filter.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          filter: { type: 'object', description: 'Query filter.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'filter'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/deleteMany',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          filter: '{filter}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'documents.aggregate',
      class: 'read',
      description: 'Run an aggregation pipeline over a collection.',
      parameters: {
        type: 'object',
        properties: {
          appId: { type: 'string', description: 'MongoDB Data API application ID.' },
          dataSourceName: { type: 'string', description: 'Data source name.' },
          databaseName: { type: 'string', description: 'Database name.' },
          collectionName: { type: 'string', description: 'Collection name.' },
          pipeline: { type: 'array', items: { type: 'object' }, description: 'Aggregation stages.' },
        },
        required: ['appId', 'dataSourceName', 'databaseName', 'collectionName', 'pipeline'],
      },
      request: {
        method: 'POST',
        path: '/{appId}/endpoint/data/v1/action/aggregate',
        body: {
          dataSource: '{dataSourceName}',
          database: '{databaseName}',
          collection: '{collectionName}',
          pipeline: '{pipeline}',
        },
      },
    },
  ],
})
