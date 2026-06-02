import { declarativeRestConnector } from './declarative-rest.js'

export const apitableConnector = declarativeRestConnector({
  kind: 'apitable',
  displayName: 'AITable',
  description: 'Read and write records in AITable (APITable) datasheets via the Fusion REST API.',
  auth: { kind: 'api-key', hint: 'AITable API token (Bearer) plus the instance URL of the AITable deployment.' },
  category: 'spreadsheet',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiTableUrl', fallback: 'https://aitable.ai' },
  test: { method: 'GET', path: '/fusion/v1/spaces' },
  capabilities: [
    {
      name: 'records.find',
      class: 'read',
      description: 'List or filter records in an AITable datasheet.',
      parameters: {
        type: 'object',
        properties: {
          datasheetId: { type: 'string' },
          recordIds: { type: 'array', items: { type: 'string' } },
          fieldNames: { type: 'array', items: { type: 'string' } },
          filter: { type: 'string' },
          maxRecords: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000 },
          pageNum: { type: 'integer', minimum: 1 },
        },
        required: ['datasheetId'],
      },
      request: {
        method: 'GET',
        path: '/fusion/v1/datasheets/{datasheetId}/records',
        query: {
          recordIds: '{recordIds}',
          fields: '{fieldNames}',
          filterByFormula: '{filter}',
          maxRecords: '{maxRecords}',
          pageSize: '{pageSize}',
          pageNum: '{pageNum}',
        },
      },
    },
    {
      name: 'records.create',
      class: 'mutation',
      description: 'Create one or more records in an AITable datasheet.',
      parameters: {
        type: 'object',
        properties: {
          datasheetId: { type: 'string' },
          records: {
            type: 'array',
            items: {
              type: 'object',
              properties: { fields: { type: 'object' } },
              required: ['fields'],
            },
          },
          fieldKey: { type: 'string', enum: ['name', 'id'] },
        },
        required: ['datasheetId', 'records'],
      },
      request: {
        method: 'POST',
        path: '/fusion/v1/datasheets/{datasheetId}/records',
        query: { fieldKey: '{fieldKey}' },
        body: { records: '{records}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'records.update',
      class: 'mutation',
      description: 'Update one or more records in an AITable datasheet.',
      parameters: {
        type: 'object',
        properties: {
          datasheetId: { type: 'string' },
          recordId: { type: 'string' },
          fields: { type: 'object' },
          fieldKey: { type: 'string', enum: ['name', 'id'] },
        },
        required: ['datasheetId', 'recordId', 'fields'],
      },
      request: {
        method: 'PATCH',
        path: '/fusion/v1/datasheets/{datasheetId}/records',
        query: { fieldKey: '{fieldKey}' },
        body: {
          records: [
            {
              recordId: '{recordId}',
              fields: '{fields}',
            },
          ],
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'records.delete',
      class: 'mutation',
      description: 'Delete one or more records from an AITable datasheet.',
      parameters: {
        type: 'object',
        properties: {
          datasheetId: { type: 'string', description: 'Datasheet to delete records from.' },
          recordIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Identifiers of records to delete.',
          },
        },
        required: ['datasheetId', 'recordIds'],
      },
      request: {
        method: 'DELETE',
        path: '/fusion/v1/datasheets/{datasheetId}/records',
        query: { recordIds: '{recordIds}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'fields.create',
      class: 'mutation',
      description: 'Add a field (column) to an AITable datasheet.',
      parameters: {
        type: 'object',
        properties: {
          datasheetId: { type: 'string', description: 'Datasheet to add the field to.' },
          name: { type: 'string', description: 'Name of the new field.' },
          type: {
            type: 'string',
            description: 'Type identifier for the field (e.g., SingleText, Number, SingleSelect).',
          },
          property: {
            type: 'object',
            description: 'Type-specific property configuration for the field.',
          },
        },
        required: ['datasheetId', 'name', 'type'],
      },
      request: {
        method: 'POST',
        path: '/fusion/v1/datasheets/{datasheetId}/fields',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'datasheets.create',
      class: 'mutation',
      description: 'Create a new datasheet in an AITable space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'Space to create the datasheet in.' },
          name: { type: 'string', description: 'Name of the new datasheet.' },
          folderId: { type: 'string', description: 'Optional parent folder.' },
          preNodeId: { type: 'string', description: 'Optional previous-sibling node id for ordering.' },
          description: { type: 'string', description: 'Optional datasheet description.' },
          fields: {
            type: 'array',
            items: { type: 'object' },
            description: 'Optional initial field definitions.',
          },
        },
        required: ['spaceId', 'name'],
      },
      request: {
        method: 'POST',
        path: '/fusion/v1/spaces/{spaceId}/datasheets',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
