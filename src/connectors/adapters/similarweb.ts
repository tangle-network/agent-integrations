import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Similarweb Digital Marketing Intelligence REST API — market-intelligence
 * reads over a website's estimated traffic, engagement, rank, traffic
 * sources, geography, audience, and search keywords. The whole surface is
 * read-only competitive/market intelligence: there is nothing to mutate.
 *
 * Auth is an account API key passed as the `api_key` QUERY PARAMETER (not a
 * header) on every v1/v4 endpoint — confirmed by the `/capabilities` curl
 * example and every reference page. (Similarweb's newer v5 endpoints and the
 * separate Batch API use an `api-key` header instead; this connector
 * deliberately covers only the uniform v1/v4 query-param surface so one
 * credential placement works for every capability.)
 *
 * Two load-bearing input conventions the agent must follow:
 *   - `domain` is a bare host like `cnn.com` (no scheme, no path).
 *   - `start_date` / `end_date` are MONTH precision `YYYY-MM` (never
 *     `YYYY-MM-DD`). `country` is a lowercase ISO 3166-1 alpha-2 code
 *     (`us`, `gb`, `de`) or `world`. `granularity` is daily|weekly|monthly.
 *
 * Data is estimated and periodically refreshed (monthly aggregates up to ~37
 * months by plan tier), so the default consistency model is `cache` — these
 * are intelligence estimates, never an authoritative live system of record.
 * Endpoints are metered against the key's data credits; `/capabilities` is
 * free and is used as the health check.
 */
export const similarwebConnector = declarativeRestConnector({
  kind: 'similarweb',
  displayName: 'Similarweb',
  description:
    'Market intelligence on any website: estimated traffic and engagement, global/country/category rank, traffic sources, geography, similar sites, audience interests, and search keywords via the Similarweb Digital Marketing Intelligence API.',
  auth: {
    kind: 'api-key',
    hint: 'Similarweb API key from Account → API Management. Sent as the `api_key` query parameter on every request.',
  },
  category: 'market-intelligence',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://api.similarweb.com',
  credentialPlacement: { kind: 'query', parameter: 'api_key' },
  // `/capabilities` is free (no data-credit cost) and proves the key is valid.
  test: { method: 'GET', path: '/capabilities' },
  capabilities: [
    {
      name: 'rank.global',
      class: 'read',
      description:
        "Similarweb Global Rank for a domain (estimated monthly unique visitors and pageviews, desktop + mobile). Lower is more popular.",
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          start_date: { type: 'string', description: 'Inclusive start month, YYYY-MM.' },
          end_date: { type: 'string', description: 'Inclusive end month, YYYY-MM.' },
          main_domain_only: { type: 'boolean', description: 'Exclude subdomains (default false).' },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/global-rank/global-rank',
        query: { start_date: '{start_date}', end_date: '{end_date}', main_domain_only: '{main_domain_only}' },
      },
    },
    {
      name: 'rank.country',
      class: 'read',
      description: 'Monthly rank of a domain within a single country.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO 3166-1 alpha-2 code, e.g. us.' },
          start_date: { type: 'string', description: 'Inclusive start month, YYYY-MM.' },
          end_date: { type: 'string', description: 'Inclusive end month, YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/country-rank/country-rank',
        query: {
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'rank.category',
      class: 'read',
      description:
        'Industry/category rank for a domain relative to its category globally (latest value; no date range).',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' } },
        required: ['domain'],
      },
      request: { method: 'GET', path: '/v1/website/{domain}/category-rank/category-rank' },
    },
    {
      name: 'total-traffic.visits',
      class: 'read',
      description: 'Estimated total visits (desktop + mobile combined) for a domain over a date range.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'Inclusive start month, YYYY-MM.' },
          end_date: { type: 'string', description: 'Inclusive end month, YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          show_verified: { type: 'boolean', description: 'Surface shared Google Analytics data when available.' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/total-traffic-and-engagement/visits',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          show_verified: '{show_verified}',
        },
      },
    },
    {
      name: 'total-traffic.pages-per-visit',
      class: 'read',
      description: 'Average pages per visit (desktop + mobile combined).',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/total-traffic-and-engagement/pages-per-visit',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'total-traffic.average-visit-duration',
      class: 'read',
      description: 'Average visit duration in seconds (desktop + mobile combined).',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/total-traffic-and-engagement/average-visit-duration',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'total-traffic.bounce-rate',
      class: 'read',
      description: 'Bounce rate (desktop + mobile combined) over a date range.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/total-traffic-and-engagement/bounce-rate',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'desktop-traffic.visits',
      class: 'read',
      description:
        'Estimated desktop-only visits for a domain. Supports a US state filter when country=us.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          state: { type: 'string', description: 'US state filter, valid only when country=us.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/traffic-and-engagement/visits',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          state: '{state}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'traffic-sources.overview-share',
      class: 'read',
      description:
        'Share of visits by marketing channel (direct, search, social, referrals, mail, display, paid) over time.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          granularity: { type: 'string', description: 'daily | weekly | monthly.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
        },
        required: ['domain', 'country', 'granularity'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/traffic-sources/overview-share',
        query: {
          country: '{country}',
          granularity: '{granularity}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
        },
      },
    },
    {
      name: 'traffic-sources.referrals',
      class: 'read',
      description: 'Top referring websites sending traffic to a domain: traffic share per referrer and total referral visits.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          limit: { type: 'integer', description: 'Max rows (default 100).' },
          offset: { type: 'integer' },
        },
        required: ['domain', 'country'],
      },
      request: {
        method: 'GET',
        path: '/v4/website/{domain}/traffic-sources/referrals',
        query: {
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'traffic-sources.social',
      class: 'read',
      description: 'Leading social networks sending traffic to a domain: traffic share per network and social visits.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['domain', 'country'],
      },
      request: {
        method: 'GET',
        path: '/v4/website/{domain}/traffic-sources/social',
        query: {
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'geo.traffic-by-country',
      class: 'read',
      description:
        'Distribution of a domain’s traffic across countries: per-country traffic share, visits, pages/visit, average duration, bounce rate, and rank.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/v4/website/{domain}/geo/traffic-by-country',
        query: {
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'audience.similar-sites',
      class: 'read',
      description: 'Up to 40 websites most similar to a domain, with a similarity score per site. No date or country params.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          limit: { type: 'integer', description: 'Max similar sites (max 40).' },
        },
        required: ['domain'],
      },
      request: {
        method: 'GET',
        path: '/v4/website/{domain}/similar-sites/similarsites',
        query: { limit: '{limit}' },
      },
    },
    {
      name: 'audience.also-visited',
      class: 'read',
      description:
        'Other websites visited by the same audience (desktop + mobile): affinity score and audience overlap. Useful for competitive/adjacency analysis.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['domain', 'country', 'start_date', 'end_date'],
      },
      request: {
        method: 'GET',
        path: '/v4/website/{domain}/total-audience-interests/also-visited',
        query: {
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'keywords.website-keywords',
      class: 'read',
      description:
        'Search keywords driving clicks to a domain (Similarweb Search 3.0). Filter by traffic_source (Organic/Paid/All) and web_source (Desktop/MobileWeb/Total). The domain is passed as the `URL` query parameter.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com (sent as the URL query param).' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          start_date: { type: 'string', description: 'YYYY-MM (defaults to ~last 28 days if omitted).' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          traffic_source: { type: 'string', description: 'Organic | Paid | All.' },
          web_source: { type: 'string', description: 'Desktop | MobileWeb | Total.' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['domain', 'country'],
      },
      request: {
        method: 'GET',
        path: '/v4/website-analysis/keywords',
        query: {
          URL: '{domain}',
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          traffic_source: '{traffic_source}',
          web_source: '{web_source}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'lead-enrichment',
      class: 'read',
      description:
        'Firmographics plus website traffic and engagement for a domain in one call (Similarweb Lead Enrichment). Up to 12 months of history; set show_verified to surface shared Google Analytics data.',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Bare host, e.g. cnn.com.' },
          country: { type: 'string', description: 'Lowercase ISO alpha-2 code or "world".' },
          start_date: { type: 'string', description: 'YYYY-MM.' },
          end_date: { type: 'string', description: 'YYYY-MM.' },
          main_domain_only: { type: 'boolean' },
          show_verified: { type: 'boolean' },
        },
        required: ['domain', 'country', 'start_date', 'end_date'],
      },
      request: {
        method: 'GET',
        path: '/v1/website/{domain}/lead-enrichment/all',
        query: {
          country: '{country}',
          start_date: '{start_date}',
          end_date: '{end_date}',
          main_domain_only: '{main_domain_only}',
          show_verified: '{show_verified}',
        },
      },
    },
  ],
})
