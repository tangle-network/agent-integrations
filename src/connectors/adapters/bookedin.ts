import { declarativeRestConnector } from './declarative-rest.js'

export const bookedinConnector = declarativeRestConnector({
  kind: 'bookedin',
  displayName: 'Bookedin',
  description: 'AI agents for lead conversion and appointment booking — manage Bookedin leads.',
  auth: { kind: 'api-key', hint: 'Bookedin API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bookedin.com',
  test: { method: 'GET', path: '/v1/leads', query: { limit: '1' } },
  capabilities: [
    {
      name: 'leads.list',
      class: 'read',
      description: 'List or search Bookedin leads with optional filters.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Search text in name, email, or phone number.' },
          source: { type: 'string', description: 'Filter by lead source.' },
          handling_status: { type: 'string' },
          limit: { type: 'integer' },
          skip: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/v1/leads',
        query: {
          search: '{search}',
          source: '{source}',
          handling_status: '{handling_status}',
          limit: '{limit}',
          skip: '{skip}',
        },
      },
    },
    {
      name: 'leads.get',
      class: 'read',
      description: 'Read a single Bookedin lead by id.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' } },
        required: ['leadId'],
      },
      request: { method: 'GET', path: '/v1/leads/{leadId}' },
    },
    {
      name: 'leads.stats',
      class: 'read',
      description: 'Get aggregate Bookedin lead statistics.',
      parameters: {
        type: 'object',
        properties: { source: { type: 'string' } },
      },
      request: { method: 'GET', path: '/v1/leads/stats', query: { source: '{source}' } },
    },
    {
      name: 'leads.create',
      class: 'mutation',
      description: 'Create a Bookedin lead.',
      parameters: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['firstName', 'lastName', 'email', 'phone'],
      },
      request: {
        method: 'POST',
        path: '/v1/leads',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          email: '{email}',
          phone: '{phone}',
          source: '{source}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'leads.update',
      class: 'mutation',
      description: 'Update an existing Bookedin lead. Individual fields merge with the optional update_json payload.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          handling_status: { type: 'string' },
          update_json: { type: 'object', description: 'Optional JSON body for complex updates. Merges with individual fields.' },
        },
        required: ['leadId'],
      },
      request: {
        method: 'PATCH',
        path: '/v1/leads/{leadId}',
        body: {
          firstName: '{firstName}',
          lastName: '{lastName}',
          email: '{email}',
          phone: '{phone}',
          handling_status: '{handling_status}',
          update_json: '{update_json}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'leads.delete',
      class: 'mutation',
      description: 'Delete a Bookedin lead.',
      parameters: {
        type: 'object',
        properties: { leadId: { type: 'string' } },
        required: ['leadId'],
      },
      request: { method: 'DELETE', path: '/v1/leads/{leadId}' },
      cas: 'optimistic-read-verify',
    },
  ],
})
