import { declarativeRestConnector } from './declarative-rest.js'

export const serviceNowConnector = declarativeRestConnector({
  kind: 'service-now',
  displayName: 'ServiceNow',
  description: 'Create, update, and query records in ServiceNow. Manage incidents, changes, service requests, and attachments.',
  auth: { kind: 'api-key', hint: 'ServiceNow instance URL, username, and password.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'instanceUrl' },
  test: { method: 'GET', path: '/api/now/v1/table/sys_user/me' },
  capabilities: [
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create a new record in a ServiceNow table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name (e.g., incident, change_request)' },
          fields: { type: 'object', description: 'Field names and values for the new record' },
        },
        required: ['table', 'fields'],
      },
      request: { method: 'POST', path: '/api/now/v2/table/{table}', body: '{fields}' },
      cas: 'native-idempotency',
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Retrieve a single record from a ServiceNow table by sys_id.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          sysSysId: { type: 'string', description: 'Record sys_id' },
        },
        required: ['table', 'sysSysId'],
      },
      request: { method: 'GET', path: '/api/now/v2/table/{table}/{sysSysId}' },
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update a record in a ServiceNow table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          sysSysId: { type: 'string', description: 'Record sys_id' },
          fields: { type: 'object', description: 'Fields to update' },
        },
        required: ['table', 'sysSysId', 'fields'],
      },
      request: { method: 'PATCH', path: '/api/now/v2/table/{table}/{sysSysId}', body: '{fields}' },
      cas: 'etag-if-match',
    },
    {
      name: 'records.find',
      class: 'read',
      description: 'Find records matching a query in a ServiceNow table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          query: { type: 'string', description: 'Encoded query (e.g., active=true^state=1)' },
          limit: { type: 'integer', description: 'Maximum records to return' },
        },
        required: ['table'],
      },
      request: {
        method: 'GET',
        path: '/api/now/v2/table/{table}',
        query: { sysparm_query: '{query}', sysparm_limit: '{limit}' },
      },
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete a record from a ServiceNow table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          sysSysId: { type: 'string', description: 'Record sys_id' },
        },
        required: ['table', 'sysSysId'],
      },
      request: { method: 'DELETE', path: '/api/now/v2/table/{table}/{sysSysId}' },
      cas: 'etag-if-match',
    },
    {
      name: 'records.count',
      class: 'read',
      description: 'Count records matching a query in a ServiceNow table.',
      parameters: {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Table name' },
          query: { type: 'string', description: 'Encoded query to filter records' },
        },
        required: ['table'],
      },
      request: {
        method: 'GET',
        path: '/api/now/v2/table/{table}',
        query: { sysparm_query: '{query}', sysparm_count: 'true' },
      },
    },
    {
      name: 'attachments.add',
      class: 'mutation',
      description: 'Attach a file to a ServiceNow record.',
      parameters: {
        type: 'object',
        properties: {
          recordSysSysId: { type: 'string', description: 'Record sys_id to attach to' },
          fileName: { type: 'string', description: 'Name for the attachment' },
          fileBase64: { type: 'string', description: 'Base64 encoded file content' },
        },
        required: ['recordSysSysId', 'fileName', 'fileBase64'],
      },
      request: {
        method: 'POST',
        path: '/api/now/v2/attachments',
        query: { table_name: 'incident', table_sys_id: '{recordSysSysId}' },
        body: '{fileBase64}',
      },
    },
    {
      name: 'attachments.find',
      class: 'read',
      description: 'Find attachments for a ServiceNow record.',
      parameters: {
        type: 'object',
        properties: {
          recordSysSysId: { type: 'string', description: 'Record sys_id' },
          limit: { type: 'integer', description: 'Maximum attachments to return' },
        },
        required: ['recordSysSysId'],
      },
      request: {
        method: 'GET',
        path: '/api/now/v2/attachments',
        query: { sysparm_query: 'table_sys_id={recordSysSysId}', sysparm_limit: '{limit}' },
      },
    },
    {
      name: 'attachments.delete',
      class: 'mutation',
      description: 'Delete an attachment from ServiceNow.',
      parameters: {
        type: 'object',
        properties: {
          attachmentSysSysId: { type: 'string', description: 'Attachment sys_id' },
        },
        required: ['attachmentSysSysId'],
      },
      request: { method: 'DELETE', path: '/api/now/v2/attachments/{attachmentSysSysId}' },
      cas: 'etag-if-match',
    },
    {
      name: 'comments.add',
      class: 'mutation',
      description: 'Add a comment to a ServiceNow record.',
      parameters: {
        type: 'object',
        properties: {
          recordSysSysId: { type: 'string', description: 'Record sys_id' },
          comment: { type: 'string', description: 'Comment text' },
          commentType: { type: 'string', description: 'Type: general or worknote' },
        },
        required: ['recordSysSysId', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/api/now/v2/table/incident/{recordSysSysId}',
        body: { comments: '{comment}' },
      },
    },
    {
      name: 'incidents.resolve',
      class: 'mutation',
      description: 'Resolve or close a ServiceNow incident.',
      parameters: {
        type: 'object',
        properties: {
          incidentSysSysId: { type: 'string', description: 'Incident sys_id' },
          resolution: { type: 'string', description: 'resolved or closed' },
          closeCode: { type: 'string', description: 'Close code' },
          closeNotes: { type: 'string', description: 'Resolution notes' },
        },
        required: ['incidentSysSysId', 'closeCode', 'closeNotes'],
      },
      request: {
        method: 'PATCH',
        path: '/api/now/v2/table/incident/{incidentSysSysId}',
        body: { state: '2', close_code: '{closeCode}', close_notes: '{closeNotes}' },
      },
      cas: 'etag-if-match',
    },
  ],
})
