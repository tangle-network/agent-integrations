import { declarativeRestConnector } from './declarative-rest.js'

// Apollo's REST API is hosted at api.apollo.io. Authentication uses an
// account-scoped API key passed in the `X-Api-Key` header. The activepieces
// piece (@activepieces/piece-apollo) wraps six endpoints across people,
// organization, and news enrichment surfaces.
export const apolloConnector = declarativeRestConnector({
  kind: 'apollo',
  displayName: 'Apollo',
  description:
    'AI sales platform for prospecting, lead gen, and deal automation. Match and enrich people and companies, search organizations, news, and people.',
  auth: {
    kind: 'api-key',
    hint: 'Apollo API key from Settings → Integrations → API. Sent as the X-Api-Key header.',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.apollo.io',
  credentialPlacement: { kind: 'header', header: 'X-Api-Key' },
  defaultHeaders: {
    accept: 'application/json',
    'content-type': 'application/json',
    'cache-control': 'no-cache',
  },
  test: { method: 'GET', path: '/api/v1/auth/health' },
  capabilities: [
    {
      name: 'match.person',
      class: 'mutation',
      description:
        'Match a person by email (and optional context) to an Apollo person record, returning enriched contact data.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the person to match.' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          name: { type: 'string' },
          organization_name: { type: 'string' },
          domain: { type: 'string', description: 'Company domain of the person.' },
          linkedin_url: { type: 'string' },
          reveal_personal_emails: { type: 'boolean' },
          reveal_phone_number: { type: 'boolean' },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/people/match',
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          name: '{name}',
          organization_name: '{organization_name}',
          domain: '{domain}',
          linkedin_url: '{linkedin_url}',
          reveal_personal_emails: '{reveal_personal_emails}',
          reveal_phone_number: '{reveal_phone_number}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'enrich.company',
      class: 'mutation',
      description: 'Enrich an organization record by domain, returning Apollo company data.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Company domain (e.g. apollo.io).' },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/organizations/enrich',
        query: { domain: '{domain}' },
      },
      cas: 'native-idempotency',
      externalEffect: false,
    },
    {
      name: 'news.articles.search',
      class: 'read',
      description:
        'Search news articles tied to organizations, with optional category and published-date filters.',
      parameters: {
        type: 'object',
        properties: {
          organization_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Apollo organization IDs to include.',
          },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'News categories to filter by (e.g. hires, investment, contract).',
          },
          published_at_min: {
            type: 'string',
            description: 'Lower bound of the date range (YYYY-MM-DD).',
          },
          published_at_max: {
            type: 'string',
            description: 'Upper bound of the date range (YYYY-MM-DD).',
          },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['organization_ids'],
      },
      request: {
        method: 'POST',
        path: '/api/v1/news_articles/search',
        body: {
          organization_ids: '{organization_ids}',
          categories: '{categories}',
          published_at_min: '{published_at_min}',
          published_at_max: '{published_at_max}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'organization.job.postings',
      class: 'read',
      description: 'List currently active job postings for a single Apollo organization.',
      parameters: {
        type: 'object',
        properties: {
          organization_id: {
            type: 'string',
            description: 'The Apollo organization ID to fetch job postings for.',
          },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['organization_id'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/organizations/{organization_id}/job_postings',
        query: {
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'organization.search',
      class: 'read',
      description:
        'Search Apollo organizations by name, domain, location, employee-count range, or industry tag.',
      parameters: {
        type: 'object',
        properties: {
          q_organization_name: { type: 'string' },
          q_organization_domains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by organization domains.',
          },
          organization_locations: {
            type: 'array',
            items: { type: 'string' },
          },
          organization_not_locations: {
            type: 'array',
            items: { type: 'string' },
          },
          organization_num_employees_ranges: {
            type: 'array',
            items: { type: 'string' },
            description: 'Employee-count ranges (e.g. "1,10", "11,50").',
          },
          organization_industry_tag_ids: {
            type: 'array',
            items: { type: 'string' },
          },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'POST',
        path: '/api/v1/mixed_companies/search',
        body: {
          q_organization_name: '{q_organization_name}',
          q_organization_domains: '{q_organization_domains}',
          organization_locations: '{organization_locations}',
          organization_not_locations: '{organization_not_locations}',
          organization_num_employees_ranges: '{organization_num_employees_ranges}',
          organization_industry_tag_ids: '{organization_industry_tag_ids}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'sequences.add_contacts',
      class: 'mutation',
      description:
        'Add one or more contacts to an Apollo emailer campaign (sequence). Optionally specify the sender mailbox to enroll under via send_email_from_email_address.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: {
            type: 'string',
            description: 'Apollo emailer_campaign (sequence) id to enroll contacts into.',
          },
          contact_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Apollo contact ids to add to the sequence.',
          },
          send_email_from_email_address: {
            type: 'string',
            description:
              'Optional sender mailbox address (must already be connected to Apollo) to send the sequence from.',
          },
        },
        required: ['campaign_id', 'contact_ids'],
      },
      request: {
        method: 'POST',
        path: '/v1/emailer_campaigns/{campaign_id}/add_contact_ids',
        body: {
          contact_ids: '{contact_ids}',
          send_email_from_email_address: '{send_email_from_email_address}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'people.search',
      class: 'read',
      description:
        'Search Apollo people records by keyword, title, seniority, location, or organization filter.',
      parameters: {
        type: 'object',
        properties: {
          q_keywords: { type: 'string', description: 'Free-text keywords for people search.' },
          person_titles: {
            type: 'array',
            items: { type: 'string' },
          },
          person_locations: {
            type: 'array',
            items: { type: 'string' },
          },
          person_seniorities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Seniority levels (e.g. owner, founder, c_suite, vp, director, manager).',
          },
          organization_ids: {
            type: 'array',
            items: { type: 'string' },
          },
          q_organization_domains: {
            type: 'array',
            items: { type: 'string' },
          },
          organization_num_employees_ranges: {
            type: 'array',
            items: { type: 'string' },
          },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'POST',
        path: '/api/v1/mixed_people/search',
        body: {
          q_keywords: '{q_keywords}',
          person_titles: '{person_titles}',
          person_locations: '{person_locations}',
          person_seniorities: '{person_seniorities}',
          organization_ids: '{organization_ids}',
          q_organization_domains: '{q_organization_domains}',
          organization_num_employees_ranges: '{organization_num_employees_ranges}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
  ],
})
