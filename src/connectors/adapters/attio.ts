import { declarativeRestConnector } from './declarative-rest.js'

// Attio is a record-centric CRM whose API v2 unifies "people", "companies", and
// any custom object behind a single `/v2/objects/{object}/records` family of
// endpoints. Reads use POST against `.../records/query` (filter body) rather
// than GET, and mutations write the same `values` shape used by query filters.
// List-entry endpoints exist in parallel to records because a single record can
// belong to multiple workspace lists with per-entry stage/owner attributes.
export const attioConnector = declarativeRestConnector({
  kind: 'attio',
  displayName: 'Attio',
  description: 'Query and mutate Attio records, lists, notes, and tasks in workspace objects.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.attio.com/authorize',
    tokenUrl: 'https://app.attio.com/oauth/token',
    scopes: [
      'record_permission:read-write',
      'object_configuration:read',
      'list_configuration:read',
      'list_entry:read-write',
      'note:read-write',
      'task:read-write',
      'comment:read-write',
      'user_management:read',
    ],
    clientIdEnv: 'ATTIO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ATTIO_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.attio.com',
  test: { method: 'GET', path: '/v2/self' },
  capabilities: [
    {
      name: 'records.query',
      class: 'read',
      description: 'Query records on an Attio object (e.g. people, companies, deals) with a filter body.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string', description: 'Object slug or id (e.g. "people", "companies", or a custom object id).' },
          filter: { type: 'object', description: 'Attio filter expression applied server-side.' },
          sorts: { type: 'array', items: { type: 'object' } },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['object'],
      },
      request: {
        method: 'POST',
        path: '/v2/objects/{object}/records/query',
        body: { filter: '{filter}', sorts: '{sorts}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['record_permission:read-write', 'object_configuration:read'],
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a single Attio record by id.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['object', 'recordId'],
      },
      request: { method: 'GET', path: '/v2/objects/{object}/records/{recordId}' },
      requiredScopes: ['record_permission:read-write'],
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a record on an Attio object. `values` is a map of attribute slug to value list.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string' },
          values: { type: 'object', description: 'Attribute slug → value list, per Attio attribute schema.' },
        },
        required: ['object', 'values'],
      },
      request: {
        method: 'POST',
        path: '/v2/objects/{object}/records',
        body: { data: { values: '{values}' } },
      },
      cas: 'native-idempotency',
      requiredScopes: ['record_permission:read-write'],
    },
    {
      name: 'records.assert',
      class: 'mutation',
      description: 'Upsert a record by matching attribute (PUT) — creates if absent, updates in place otherwise.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string' },
          matching_attribute: { type: 'string', description: 'Attribute slug used as the dedupe key (e.g. "email_addresses").' },
          values: { type: 'object' },
        },
        required: ['object', 'matching_attribute', 'values'],
      },
      request: {
        method: 'PUT',
        path: '/v2/objects/{object}/records',
        query: { matching_attribute: '{matching_attribute}' },
        body: { data: { values: '{values}' } },
      },
      cas: 'native-idempotency',
      requiredScopes: ['record_permission:read-write'],
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Partially update an Attio record. Provided attribute slugs overwrite existing values.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string' },
          recordId: { type: 'string' },
          values: { type: 'object' },
        },
        required: ['object', 'recordId', 'values'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/objects/{object}/records/{recordId}',
        body: { data: { values: '{values}' } },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['record_permission:read-write'],
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Permanently delete an Attio record.',
      parameters: {
        type: 'object',
        properties: {
          object: { type: 'string' },
          recordId: { type: 'string' },
        },
        required: ['object', 'recordId'],
      },
      request: { method: 'DELETE', path: '/v2/objects/{object}/records/{recordId}' },
      cas: 'native-idempotency',
      requiredScopes: ['record_permission:read-write'],
    },
    {
      name: 'lists.entries.query',
      class: 'read',
      description: 'Query entries on an Attio list (e.g. pipeline stages, target lists).',
      parameters: {
        type: 'object',
        properties: {
          list: { type: 'string', description: 'List slug or id.' },
          filter: { type: 'object' },
          sorts: { type: 'array', items: { type: 'object' } },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
        },
        required: ['list'],
      },
      request: {
        method: 'POST',
        path: '/v2/lists/{list}/entries/query',
        body: { filter: '{filter}', sorts: '{sorts}', limit: '{limit}', offset: '{offset}' },
      },
      requiredScopes: ['list_entry:read-write', 'list_configuration:read'],
    },
    {
      name: 'lists.entries.create',
      class: 'mutation',
      description: 'Add a record to an Attio list with optional per-entry attribute values.',
      parameters: {
        type: 'object',
        properties: {
          list: { type: 'string' },
          parent_record_id: { type: 'string', description: 'Record id to add to the list.' },
          parent_object: { type: 'string', description: 'Object slug the record belongs to.' },
          entry_values: { type: 'object', description: 'Per-entry attribute slug → value list (stage, owner, etc.).' },
        },
        required: ['list', 'parent_record_id', 'parent_object'],
      },
      request: {
        method: 'POST',
        path: '/v2/lists/{list}/entries',
        body: {
          data: {
            parent_record_id: '{parent_record_id}',
            parent_object: '{parent_object}',
            entry_values: '{entry_values}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['list_entry:read-write'],
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description: 'Create a note attached to an Attio record.',
      parameters: {
        type: 'object',
        properties: {
          parent_object: { type: 'string', description: 'Object slug the note attaches to.' },
          parent_record_id: { type: 'string' },
          title: { type: 'string' },
          format: { type: 'string', enum: ['plaintext', 'markdown'] },
          content: { type: 'string' },
        },
        required: ['parent_object', 'parent_record_id', 'content'],
      },
      request: {
        method: 'POST',
        path: '/v2/notes',
        body: {
          data: {
            parent_object: '{parent_object}',
            parent_record_id: '{parent_record_id}',
            title: '{title}',
            format: '{format}',
            content: '{content}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['note:read-write'],
    },
    {
      name: 'tasks.create',
      class: 'mutation',
      description: 'Create a task, optionally linked to records and assignees.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          format: { type: 'string', enum: ['plaintext'] },
          deadline_at: { type: 'string', description: 'ISO-8601 deadline.' },
          is_completed: { type: 'boolean' },
          linked_records: { type: 'array', items: { type: 'object' } },
          assignees: { type: 'array', items: { type: 'object' } },
        },
        required: ['content'],
      },
      request: {
        method: 'POST',
        path: '/v2/tasks',
        body: {
          data: {
            content: '{content}',
            format: '{format}',
            deadline_at: '{deadline_at}',
            is_completed: '{is_completed}',
            linked_records: '{linked_records}',
            assignees: '{assignees}',
          },
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['task:read-write'],
    },
  ],
})
