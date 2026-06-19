import { declarativeRestConnector } from './declarative-rest.js'

// Saleshandy — Cold email outreach platform: manage prospects, build sequences, add prospects to sequence steps, and control sequence status.
// Auth: api-key. Base: https://open-api.saleshandy.com. Docs: https://developer.saleshandy.com/api-reference/introduction
export const saleshandyConnector = declarativeRestConnector({
  kind: 'saleshandy',
  displayName: 'Saleshandy',
  description: 'Cold email outreach platform: manage prospects, build sequences, add prospects to sequence steps, and control sequence status.',
  auth: {
    kind: 'api-key',
    hint: 'Generate an API key in company Settings -> API Settings. Sent as the x-api-key header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://open-api.saleshandy.com',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/v1/user/team-member-list' },
  capabilities: [
    {
      name: 'sequences.list',
      class: 'read',
      description: 'List sequences and their steps.',
      parameters: {
        type: 'object',
        properties: {
          sequenceName: { type: 'string', description: 'Filter by sequence name.' },
          page: { type: 'integer', description: 'Page number.' },
          pageSize: { type: 'integer', description: 'Results per page.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/sequences',
        query: { sequenceName: '{sequenceName}', page: '{page}', pageSize: '{pageSize}' },
      },
    },
    {
      name: 'prospects.list',
      class: 'read',
      description: 'List all prospects with pagination and search.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search term.' },
          page: { type: 'integer', description: 'Page number.' },
          pageSize: { type: 'integer', description: 'Results per page.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/v1/prospects',
        query: { search: '{search}', page: '{page}', pageSize: '{pageSize}' },
      },
    },
    {
      name: 'sequence.import_prospects',
      class: 'mutation',
      description: 'Import prospects (keyed by field name) into a sequence at a given step.',
      parameters: {
        type: 'object',
        properties: {
          prospectList: {
            type: 'array',
            description: 'Array of prospect objects keyed by field name (e.g. Email, First Name).',
            items: { type: 'object' },
          },
          stepId: { type: 'integer', description: 'Sequence step ID to add prospects to.' },
          conflictAction: {
            type: 'string',
            description: 'How to handle duplicates (e.g. skip, update).',
          },
          verifyProspects: { type: 'boolean', description: 'Verify emails on import.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply.' },
        },
        required: ['prospectList', 'stepId', 'conflictAction'],
      },
      request: {
        method: 'POST',
        path: '/v1/sequences/prospects/import-with-field-name',
        body: {
          prospectList: '{prospectList}',
          stepId: '{stepId}',
          conflictAction: '{conflictAction}',
          verifyProspects: '{verifyProspects}',
          tags: '{tags}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'sequence.set_status',
      class: 'mutation',
      description: 'Activate or pause one or more sequences.',
      parameters: {
        type: 'object',
        properties: {
          sequenceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sequence IDs to update.',
          },
          status: { type: 'string', description: 'Target status (e.g. ACTIVE, PAUSED).' },
        },
        required: ['sequenceIds', 'status'],
      },
      request: {
        method: 'POST',
        path: '/v1/sequences/status',
        body: { sequenceIds: '{sequenceIds}', status: '{status}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
