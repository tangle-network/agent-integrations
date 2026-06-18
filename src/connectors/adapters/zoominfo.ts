import { declarativeRestConnector } from './declarative-rest.js'

/**
 * ZoomInfo GTM Data API — sales-intelligence search and enrich over ZoomInfo's
 * contact, company, intent, scoops, and news data.
 *
 * This targets the modern GTM API (`/gtm/data/v1/…`) with OAuth2, NOT the
 * deprecated legacy Enterprise API (flat `/search/contact` paths authenticated
 * by a `username + clientId + privateKey` JWT via POST /authenticate). The GTM
 * surface supports both the authorization_code (+PKCE) and client_credentials
 * grants against the same token endpoint; we declare the interactive
 * authorization_code flow here (the platform performs the grant and injects the
 * access token — the runtime only ever sends `Authorization: Bearer`).
 *
 * A free GTM.AI MCP developer tier (500 AI + 100 bulk-data credits) exists for
 * experimentation, but it is a separate agent/MCP product, not this REST
 * surface; direct REST access requires a ZoomInfo Enterprise API or Copilot
 * package with an admin-assigned DevPortal subscription.
 *
 * Two conventions the runtime relies on:
 *   - Responses use the JSON:API content type `application/vnd.api+json`; the
 *     body is still valid JSON, which the runtime parses fine.
 *   - Every search/enrich request wraps its criteria in a top-level `{ data:
 *     { … } }` object. The exact inner filter field names are NOT in the public
 *     reference and must be discovered at runtime via `lookup.search_fields`
 *     (input/output field names) and `lookup.data` (enumerated values), so each
 *     search/enrich capability takes a single free-form `data` object the agent
 *     builds, rather than hardcoded per-field placeholders.
 *
 * Pagination uses ZoomInfo's bracketed query keys `page[number]` / `page[size]`;
 * the agent passes plain `pageNumber` / `pageSize` args which the adapter maps
 * onto those keys.
 *
 * `*.search` is free and modeled as a read. `*.enrich` consumes 1 bulk-data
 * credit per matched record (waived if the record is already under management
 * within a 12-month window), so — like the Apollo enrich actions — it is a
 * side-effectful mutation the planner should confirm before spending credits.
 */
export const zoominfoConnector = declarativeRestConnector({
  kind: 'zoominfo',
  displayName: 'ZoomInfo',
  description:
    'Search and enrich contacts and companies, plus buyer-intent signals, business Scoops, and company news, via the ZoomInfo GTM Data API. Search is free; enrich consumes bulk-data credits.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.zoominfo.com/gtm/oauth/v1/authorize',
    tokenUrl: 'https://api.zoominfo.com/gtm/oauth/v1/token',
    scopes: [
      'api:data:contact',
      'api:data:company',
      'api:data:intent',
      'api:data:scoops',
      'api:data:news',
    ],
    clientIdEnv: 'ZOOMINFO_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOOMINFO_OAUTH_CLIENT_SECRET',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zoominfo.com',
  // `users/usage` is a free GET that proves the access token is valid.
  test: { method: 'GET', path: '/gtm/data/v1/users/usage' },
  capabilities: [
    {
      name: 'contact.search',
      class: 'read',
      description:
        'Search the contact database by firmographic/persona criteria. Returns ranked matches with stable contactId values and basic info only (no emails/phones). Free. Pass contactId to contact.enrich for full detail.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Search criteria wrapped under `data`, e.g. { companyName, jobTitle: ["VP Sales"], managementLevel, zipCode }. Resolve valid field names via lookup.search_fields (entity=contact, fieldType=input).',
          },
          pageNumber: { type: 'integer', description: 'Page number, >= 1 (default 1).' },
          pageSize: { type: 'integer', description: 'Page size, 1–100 (default 25).' },
          sort: { type: 'string', description: 'Sort field; prefix with - for descending.' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/contacts/search',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}', sort: '{sort}' },
        body: { data: '{data}' },
      },
    },
    {
      name: 'company.search',
      class: 'read',
      description:
        'Search the company database by firmographic filters (industry, revenue, employee count, geography, tech stack). Returns basic company info and stable companyId values. Free.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Search criteria under `data`, e.g. { companyName, industry, employeeCount, revenue, location, technologies }. Resolve fields via lookup.search_fields (entity=company, fieldType=input).',
          },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
          sort: { type: 'string' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/companies/search',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}', sort: '{sort}' },
        body: { data: '{data}' },
      },
    },
    {
      name: 'intent.search',
      class: 'read',
      description:
        'Search for companies showing buyer-intent signals across 1–50 intent topics. Returns ranked companies with intent signal scores. Free.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description: 'Criteria under `data`, must include topics: ["cybersecurity", "cloud migration"] plus optional filters.',
          },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
          sort: { type: 'string' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/intent/search',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}', sort: '{sort}' },
        body: { data: '{data}' },
      },
    },
    {
      name: 'scoops.search',
      class: 'read',
      description:
        'Search real-time business-intelligence signals (Scoops: hiring, expansion, tech changes) across ZoomInfo companies. Free; each scoop counts against the record limit.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Scoop filter criteria under `data`.' },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
          sort: { type: 'string', description: 'e.g. scoopId | originalPublishedDate; default -originalPublishedDate.' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/scoops/search',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}', sort: '{sort}' },
        body: { data: '{data}' },
      },
    },
    {
      name: 'news.search',
      class: 'read',
      description:
        'Search news articles across ZoomInfo companies. All filters optional but at least one must be set. Free; each article counts as one record. No sort param.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'News filter criteria under `data`, e.g. { companyId, keywords }.' },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/news/search',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}' },
        body: { data: '{data}' },
      },
    },
    {
      name: 'contact.enrich',
      class: 'mutation',
      description:
        'Enrich up to 25 contacts with full detail (email, phone, jobTitle, 300+ fields). Best practice: contact.search first, then pass contactId. CONSUMES 1 bulk-data credit per matched record returned (waived if under management). `data` carries matchPersonInput + outputFields (+ optional requiredFields).',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Enrich body under `data`, e.g. { matchPersonInput: [{ contactId } | { firstName, lastName, companyName, emailAddress }], outputFields: ["id","email","phone","jobTitle"], requiredFields: [] }.',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/gtm/data/v1/contacts/enrich', body: { data: '{data}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'company.enrich',
      class: 'mutation',
      description:
        'Enrich up to 25 companies with 300+ data points (firmographics, technographics). Best practice: company.search first, then pass companyId. CONSUMES 1 bulk-data credit per matched record. `data` carries matchCompanyInput + outputFields.',
      parameters: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            description:
              'Enrich body under `data`, e.g. { matchCompanyInput: [{ companyId } | { companyName, website }], outputFields: ["id","name","website","industry","employeeCount","revenue"], requiredFields: [] }.',
          },
        },
        required: ['data'],
      },
      request: { method: 'POST', path: '/gtm/data/v1/companies/enrich', body: { data: '{data}' } },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'intent.enrich',
      class: 'mutation',
      description:
        'Fetch intent signals for a specific known company (companyId, companyName, or companyWebsite) across 1–50 topics. CONSUMES bulk-data credits per enriched company.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Body under `data`, e.g. { companyId, topics: [...] }.' },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/intent/enrich',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}' },
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'scoops.enrich',
      class: 'mutation',
      description:
        'Fetch Scoops for a specific known company (at least one company identifier). CONSUMES 1 credit per enriched company; each returned scoop counts against the record limit.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Body under `data`, e.g. { companyId }.' },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/scoops/enrich',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}' },
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'news.enrich',
      class: 'mutation',
      description:
        'Fetch categorized news coverage for a specific known company (at least one company identifier). CONSUMES bulk-data credits per enriched company.',
      parameters: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Body under `data`, e.g. { companyId }.' },
          pageNumber: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
        required: ['data'],
      },
      request: {
        method: 'POST',
        path: '/gtm/data/v1/news/enrich',
        query: { 'page[number]': '{pageNumber}', 'page[size]': '{pageSize}' },
        body: { data: '{data}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'lookup.data',
      class: 'read',
      description:
        'Retrieve enumerated valid values for a filter field (industries, regions, job functions, management levels, technologies, intent topics). Use to build valid search bodies. Free.',
      parameters: {
        type: 'object',
        properties: {
          fieldName: { type: 'string', description: 'The filter field to enumerate, e.g. industry, managementLevel.' },
          category: { type: 'string' },
          parentCategory: { type: 'string' },
          subCategory: { type: 'string' },
          vendor: { type: 'string' },
        },
        required: ['fieldName'],
      },
      request: {
        method: 'GET',
        path: '/gtm/data/v1/lookup/{fieldName}',
        query: {
          'filter[category]': '{category}',
          'filter[parentCategory]': '{parentCategory}',
          'filter[subCategory]': '{subCategory}',
          'filter[vendor]': '{vendor}',
        },
      },
    },
    {
      name: 'lookup.search_fields',
      class: 'read',
      description:
        'Discover the valid input and output field names for a search/enrich entity. REQUIRED to build correct search/enrich bodies and enrich outputFields. Free.',
      parameters: {
        type: 'object',
        properties: {
          entity: { type: 'string', description: 'company | contact | scoop | news | intent.' },
          fieldType: { type: 'string', description: 'input | output.' },
        },
        required: ['entity', 'fieldType'],
      },
      request: {
        method: 'GET',
        path: '/gtm/data/v1/lookup/search',
        query: { 'filter[entity]': '{entity}', 'filter[fieldType]': '{fieldType}' },
      },
    },
    {
      name: 'usage.get',
      class: 'read',
      description: 'Return the current user’s API usage and limits (credits consumed, request counts, entitlements). Free.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/gtm/data/v1/users/usage' },
    },
  ],
})
