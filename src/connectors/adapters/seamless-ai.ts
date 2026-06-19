import { declarativeRestConnector } from './declarative-rest.js'

// Seamless.ai — Search and enrich B2B contact and company data, including verified emails, phone numbers, and job-change signals, for go-to-market prospecting.
// Auth: api-key. Base: https://api.seamless.ai/api/client/v1. Docs: https://docs.seamless.ai/introduction
export const seamlessAiConnector = declarativeRestConnector({
  kind: 'seamless-ai',
  displayName: 'Seamless.ai',
  description: 'Search and enrich B2B contact and company data, including verified emails, phone numbers, and job-change signals, for go-to-market prospecting.',
  auth: {
    kind: 'api-key',
    hint: 'API key from Settings -> API Key (Create New Connection). Sent as the Token header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.seamless.ai/api/client/v1',
  credentialPlacement: { kind: 'header', header: 'Token' },
  defaultHeaders: { 'content-type': 'application/json' },
  capabilities: [
    {
      name: 'contacts.search',
      class: 'read',
      description: 'Search for contacts by company, location, department, job title, seniority, and technologies. Returns search result ids used for research/enrichment.',
      parameters: {
        type: 'object',
        properties: {
          jobTitle: { type: 'array', items: { type: 'string' } },
          seniority: { type: 'array', items: { type: 'string' } },
          companyDomain: { type: 'array', items: { type: 'string' } },
          industry: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
          nextToken: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/search/contacts',
        body: {
          jobTitle: '{jobTitle}',
          seniority: '{seniority}',
          companyDomain: '{companyDomain}',
          industry: '{industry}',
          limit: '{limit}',
          nextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'companies.search',
      class: 'read',
      description: 'Search for companies by name, domain, location, industry, size, revenue, and technologies. Returns search result ids used for research/enrichment.',
      parameters: {
        type: 'object',
        properties: {
          companyName: { type: 'array', items: { type: 'string' } },
          companyDomain: { type: 'array', items: { type: 'string' } },
          industry: { type: 'array', items: { type: 'string' } },
          companySize: { type: 'array', items: { type: 'string' } },
          technologies: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
          nextToken: { type: 'string' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/search/companies',
        body: {
          companyName: '{companyName}',
          companyDomain: '{companyDomain}',
          industry: '{industry}',
          companySize: '{companySize}',
          technologies: '{technologies}',
          limit: '{limit}',
          nextToken: '{nextToken}',
        },
      },
    },
    {
      name: 'contacts.research',
      class: 'mutation',
      description: 'Research (enrich) contacts asynchronously by searchResultIds from a contact search, or by explicit contact identifiers, to reveal full profile, email, and phone.',
      parameters: {
        type: 'object',
        properties: {
          searchResultIds: { type: 'array', items: { type: 'string' } },
          contacts: { type: 'array', items: { type: 'object' } },
          isJobChange: { type: 'boolean' },
          skipDeduplicationCheck: { type: 'boolean' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/contacts/research',
        body: {
          searchResultIds: '{searchResultIds}',
          contacts: '{contacts}',
          isJobChange: '{isJobChange}',
          skipDeduplicationCheck: '{skipDeduplicationCheck}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'companies.research',
      class: 'mutation',
      description: 'Research (enrich) companies asynchronously by searchResultIds from a company search, or by direct company identifiers.',
      parameters: {
        type: 'object',
        properties: {
          searchResultIds: { type: 'array', items: { type: 'string' } },
          companies: { type: 'array', items: { type: 'object' } },
          skipDeduplicationCheck: { type: 'boolean' },
        },
        required: [],
      },
      request: {
        method: 'POST',
        path: '/companies/research',
        body: {
          searchResultIds: '{searchResultIds}',
          companies: '{companies}',
          skipDeduplicationCheck: '{skipDeduplicationCheck}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'contacts.research.poll',
      class: 'read',
      description: 'Poll for the results of a previously submitted contact research (enrichment) request by request id.',
      parameters: {
        type: 'object',
        properties: { requestIds: { type: 'array', items: { type: 'string' } } },
        required: ['requestIds'],
      },
      request: {
        method: 'GET',
        path: '/contacts/research/poll',
        query: { requestIds: '{requestIds}' },
      },
    },
  ],
})
