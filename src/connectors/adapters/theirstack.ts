import { declarativeRestConnector } from './declarative-rest.js'

// TheirStack — Jobs and technographics data API. Search job postings and companies across 100+ countries, look up a company's tech stack, and detect buying intent.
// Auth: api-key. Base: https://api.theirstack.com. Docs: https://theirstack.com/en/docs/api-reference/quickstart
export const theirstackConnector = declarativeRestConnector({
  kind: 'theirstack',
  displayName: 'TheirStack',
  description: 'Jobs and technographics data API. Search job postings and companies across 100+ countries, look up a company\'s tech stack, and detect buying intent.',
  auth: {
    kind: 'api-key',
    hint: 'API key from app.theirstack.com/settings/api. Sent as the Authorization: Bearer header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.theirstack.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/v0/billing/credit-balance' },
  capabilities: [
    {
      name: 'jobs.search',
      class: 'read',
      description: 'Search job postings with filters (title, country, technology, posting recency, company). Requires at least one filter such as posted_at_max_age_days. Costs 1 credit per job returned.',
      parameters: {
        type: 'object',
        properties: {
          posted_at_max_age_days: { type: 'integer' },
          job_title_or: { type: 'array', items: { type: 'string' } },
          job_country_code_or: { type: 'array', items: { type: 'string' } },
          company_technology_slug_or: { type: 'array', items: { type: 'string' } },
          company_name_or: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer' },
          page: { type: 'integer' },
        },
        required: ['posted_at_max_age_days', 'limit', 'page'],
      },
      request: {
        method: 'POST',
        path: '/v1/jobs/search',
        body: {
          posted_at_max_age_days: '{posted_at_max_age_days}',
          job_title_or: '{job_title_or}',
          job_country_code_or: '{job_country_code_or}',
          company_technology_slug_or: '{company_technology_slug_or}',
          company_name_or: '{company_name_or}',
          limit: '{limit}',
          page: '{page}',
        },
      },
    },
    {
      name: 'companies.search',
      class: 'read',
      description: 'Search companies by country, technologies used, industry, funding, and nested job filters. Costs 3 credits per company returned.',
      parameters: {
        type: 'object',
        properties: {
          company_country_code_or: { type: 'array', items: { type: 'string' } },
          company_technology_slug_or: { type: 'array', items: { type: 'string' } },
          industry_id_or: { type: 'array', items: { type: 'integer' } },
          min_funding_usd: { type: 'integer' },
          max_funding_usd: { type: 'integer' },
          limit: { type: 'integer' },
          page: { type: 'integer' },
        },
        required: ['limit', 'page'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/search',
        body: {
          company_country_code_or: '{company_country_code_or}',
          company_technology_slug_or: '{company_technology_slug_or}',
          industry_id_or: '{industry_id_or}',
          min_funding_usd: '{min_funding_usd}',
          max_funding_usd: '{max_funding_usd}',
          limit: '{limit}',
          page: '{page}',
        },
      },
    },
    {
      name: 'companies.technologies',
      class: 'read',
      description: 'Look up the technologies (tech stack) detected for a company identified by domain, name, or LinkedIn URL. Costs 3 credits per company lookup.',
      parameters: {
        type: 'object',
        properties: {
          company_domain: { type: 'string' },
          company_name: { type: 'string' },
          company_linkedin_url: { type: 'string' },
          technology_slug_or: { type: 'array', items: { type: 'string' } },
        },
        required: ['company_domain'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/technologies',
        body: {
          company_domain: '{company_domain}',
          company_name: '{company_name}',
          company_linkedin_url: '{company_linkedin_url}',
          technology_slug_or: '{technology_slug_or}',
        },
      },
    },
    {
      name: 'companies.buying_intents',
      class: 'read',
      description: 'Retrieve buying-intent signals for a company identified by domain, name, or LinkedIn URL. Costs 3 credits per company lookup.',
      parameters: {
        type: 'object',
        properties: {
          company_domain: { type: 'string' },
          company_name: { type: 'string' },
          company_linkedin_url: { type: 'string' },
        },
        required: ['company_domain'],
      },
      request: {
        method: 'POST',
        path: '/v1/companies/buying_intents',
        body: {
          company_domain: '{company_domain}',
          company_name: '{company_name}',
          company_linkedin_url: '{company_linkedin_url}',
        },
      },
    },
  ],
})
