import { declarativeRestConnector } from './declarative-rest.js'

export const proxycurlConnector = declarativeRestConnector({
  kind: 'proxycurl',
  displayName: 'Proxycurl',
  description: 'Enrich LinkedIn people and company profiles with Proxycurl.',
  auth: { kind: 'api-key', hint: 'Proxycurl API key.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.proxycurl.com',
  test: { method: 'GET', path: '/api/linkedin/profile/in_convert/url' },
  capabilities: [
    {
      name: 'person.profile.get',
      class: 'read',
      description: 'Get person profile from LinkedIn URL.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_profile_url: { type: 'string' },
          extra: { type: 'string' },
          github_profile_id: { type: 'string' },
          twitter_profile_id: { type: 'string' },
          facebook_profile_id: { type: 'string' },
        },
        required: ['linkedin_profile_url'],
      },
      request: {
        method: 'GET',
        path: '/api/linkedin/profile',
        query: {
          linkedin_profile_url: '{linkedin_profile_url}',
          extra: '{extra}',
          github_profile_id: '{github_profile_id}',
          twitter_profile_id: '{twitter_profile_id}',
          facebook_profile_id: '{facebook_profile_id}',
        },
      },
    },
    {
      name: 'company.profile.get',
      class: 'read',
      description: 'Get company profile from LinkedIn URL.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_company_url: { type: 'string' },
          extra: { type: 'string' },
          resolve_numeric_id: { type: 'boolean' },
          categories: { type: 'string' },
        },
        required: ['linkedin_company_url'],
      },
      request: {
        method: 'GET',
        path: '/api/linkedin/company',
        query: {
          linkedin_company_url: '{linkedin_company_url}',
          extra: '{extra}',
          resolve_numeric_id: '{resolve_numeric_id}',
          categories: '{categories}',
        },
      },
    },
    {
      name: 'people.search',
      class: 'read',
      description: 'Search people on LinkedIn.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_first_name: { type: 'string' },
          linkedin_last_name: { type: 'string' },
          linkedin_company_name: { type: 'string' },
          linkedin_title: { type: 'string' },
          linkedin_city: { type: 'string' },
          linkedin_country: { type: 'string' },
          page_size: { type: 'integer' },
          enrich_profile: { type: 'boolean' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/api/linkedin/profile/search',
        query: {
          linkedin_first_name: '{linkedin_first_name}',
          linkedin_last_name: '{linkedin_last_name}',
          linkedin_company_name: '{linkedin_company_name}',
          linkedin_title: '{linkedin_title}',
          linkedin_city: '{linkedin_city}',
          linkedin_country: '{linkedin_country}',
          page_size: '{page_size}',
          enrich_profile: '{enrich_profile}',
        },
      },
    },
    {
      name: 'person.email.lookup',
      class: 'read',
      description: 'Lookup person email from LinkedIn profile URL.',
      parameters: {
        type: 'object',
        properties: {
          linkedin_profile_url: { type: 'string' },
          company_domain: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
        },
        required: ['linkedin_profile_url'],
      },
      request: {
        method: 'GET',
        path: '/api/linkedin/profile/email',
        query: {
          linkedin_profile_url: '{linkedin_profile_url}',
          company_domain: '{company_domain}',
          first_name: '{first_name}',
          last_name: '{last_name}',
        },
      },
    },
  ],
})
