import { declarativeRestConnector } from './declarative-rest.js'

// Hunter.io REST API is hosted at api.hunter.io. Authentication is an
// account-scoped API key passed as the `api_key` query parameter on every
// request. The activepieces piece (@activepieces/piece-hunter) wraps nine
// actions across email discovery/verification and the leads + campaigns CRUD.
export const hunterConnector = declarativeRestConnector({
  kind: 'hunter',
  displayName: 'Hunter',
  description:
    'Find, verify and manage professional email addresses at scale. Automate email discovery, validation, lead tracking, and campaign outreach with Hunter.io.',
  auth: {
    kind: 'api-key',
    hint: 'Hunter API key from API → API keys. Sent as the api_key query parameter.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.hunter.io',
  credentialPlacement: { kind: 'query', parameter: 'api_key' },
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/v2/account' },
  capabilities: [
    {
      name: 'find.email',
      class: 'read',
      description:
        'Find the most likely email address of a person at a company, given the company domain and the person name.',
      parameters: {
        type: 'object',
        properties: {
          domain: {
            type: 'string',
            description: 'Domain name of the company (e.g. stripe.com).',
          },
          company: {
            type: 'string',
            description: 'Company name, used when the domain is not known.',
          },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          full_name: { type: 'string' },
          max_duration: { type: 'integer', minimum: 3, maximum: 20 },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/email-finder',
        query: {
          domain: '{domain}',
          company: '{company}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          full_name: '{full_name}',
          max_duration: '{max_duration}',
        },
      },
    },
    {
      name: 'verify.email',
      class: 'mutation',
      description:
        'Verify the deliverability of an email address. Marked as a mutation because Hunter bills a verification credit per call.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to verify.' },
        },
        required: ['email'],
      },
      request: {
        method: 'GET',
        path: '/v2/email-verifier',
        query: { email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'count.emails',
      class: 'mutation',
      description:
        'Return the total number of email addresses Hunter has indexed for a given domain or company. Counts against the search-quota.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          company: { type: 'string' },
          type: {
            type: 'string',
            enum: ['personal', 'generic'],
            description: 'Restrict the count to personal or generic email addresses.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/email-count',
        query: {
          domain: '{domain}',
          company: '{company}',
          type: '{type}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'search.leads',
      class: 'read',
      description: 'List or search leads in the Hunter account.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          offset: { type: 'integer', minimum: 0 },
          lead_list_id: { type: 'integer' },
          query: { type: 'string', description: 'Free-text query (matches email, name, company).' },
          email: { type: 'string' },
          company: { type: 'string' },
          phone_number: { type: 'string' },
          twitter: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/leads',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          lead_list_id: '{lead_list_id}',
          query: '{query}',
          email: '{email}',
          company: '{company}',
          phone_number: '{phone_number}',
          twitter: '{twitter}',
        },
      },
    },
    {
      name: 'get.lead',
      class: 'read',
      description: 'Return a single lead by its Hunter lead ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The Hunter lead ID.' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/v2/leads/{id}',
      },
    },
    {
      name: 'create.lead',
      class: 'mutation',
      description: 'Create a new lead in the Hunter account.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          position: { type: 'string' },
          company: { type: 'string' },
          company_industry: { type: 'string' },
          company_size: { type: 'string' },
          confidence_score: { type: 'integer', minimum: 0, maximum: 100 },
          website: { type: 'string' },
          country_code: { type: 'string' },
          linkedin_url: { type: 'string' },
          phone_number: { type: 'string' },
          twitter: { type: 'string' },
          notes: { type: 'string' },
          source: { type: 'string' },
          lead_list_id: { type: 'integer' },
        },
      },
      request: {
        method: 'POST',
        path: '/v2/leads',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          position: '{position}',
          company: '{company}',
          company_industry: '{company_industry}',
          company_size: '{company_size}',
          confidence_score: '{confidence_score}',
          website: '{website}',
          country_code: '{country_code}',
          linkedin_url: '{linkedin_url}',
          phone_number: '{phone_number}',
          twitter: '{twitter}',
          notes: '{notes}',
          source: '{source}',
          lead_list_id: '{lead_list_id}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'update.lead',
      class: 'mutation',
      description: 'Update an existing lead. Only fields included in the request are modified.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The Hunter lead ID.' },
          email: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          position: { type: 'string' },
          company: { type: 'string' },
          company_industry: { type: 'string' },
          company_size: { type: 'string' },
          confidence_score: { type: 'integer', minimum: 0, maximum: 100 },
          website: { type: 'string' },
          country_code: { type: 'string' },
          linkedin_url: { type: 'string' },
          phone_number: { type: 'string' },
          twitter: { type: 'string' },
          notes: { type: 'string' },
          source: { type: 'string' },
          lead_list_id: { type: 'integer' },
        },
        required: ['id'],
      },
      request: {
        method: 'PUT',
        path: '/v2/leads/{id}',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          position: '{position}',
          company: '{company}',
          company_industry: '{company_industry}',
          company_size: '{company_size}',
          confidence_score: '{confidence_score}',
          website: '{website}',
          country_code: '{country_code}',
          linkedin_url: '{linkedin_url}',
          phone_number: '{phone_number}',
          twitter: '{twitter}',
          notes: '{notes}',
          source: '{source}',
          lead_list_id: '{lead_list_id}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'delete.lead',
      class: 'mutation',
      description: 'Permanently delete a lead from the Hunter account.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'The Hunter lead ID.' },
        },
        required: ['id'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/leads/{id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'add.recipients',
      class: 'mutation',
      description: 'Add recipients (leads or raw email addresses) to a Hunter Campaigns campaign.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: {
            type: 'integer',
            description: 'The Hunter campaign ID to add recipients to.',
          },
          emails: {
            type: 'array',
            items: { type: 'string' },
            description: 'Email addresses to add as recipients.',
          },
          lead_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Existing Hunter lead IDs to add as recipients.',
          },
        },
        required: ['campaign_id'],
      },
      request: {
        method: 'POST',
        path: '/v2/campaigns/{campaign_id}/recipients',
        body: {
          emails: '{emails}',
          lead_ids: '{lead_ids}',
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
