import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Semrush v4 REST API — market-intelligence reads over a site's backlink
 * profile and keyword metrics for competitive SEO analysis.
 *
 * IMPORTANT — JSON-only scope. Semrush has two API generations:
 *   - The classic Analytics API (`api.semrush.com/?type=domain_organic&key=…`)
 *     and the Trends API authenticate with a `key=` QUERY param and return
 *     SEMICOLON-SEPARATED CSV. The declarative runtime JSON.parses every
 *     response body, so those CSV surfaces are deliberately NOT covered here.
 *   - The newer v4 REST surface (`/apis/v4/…`) returns JSON and authenticates
 *     with the `Authorization: Apikey <key>` header. This connector covers
 *     ONLY the v4 JSON surface so one credential placement and one parser work
 *     for every capability.
 *
 * Auth: an API key from Semrush → Subscription info → API units, sent as
 * `Authorization: Apikey <key>` (the literal word "Apikey", a space, then the
 * key — NOT "Bearer", NOT a query param).
 *
 * The backlinks endpoints take `url` (the target host/page) plus a `scope`
 * (ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE). Each returned row consumes API
 * units, so callers should use `limit`/`offset` deliberately. Metrics are
 * periodically-recomputed estimates, hence the `cache` consistency model.
 *
 * The v4 keyword surface (`keyword.metrics`) is less thoroughly documented
 * than backlinks; its exact param names are the JSON replacement for the
 * deprecated classic `phrase_this` CSV report — verify against live docs if a
 * call 4xxs.
 */
export const semrushConnector = declarativeRestConnector({
  kind: 'semrush',
  displayName: 'Semrush',
  description:
    'Competitive SEO market intelligence: backlink profile (overview, links, referring domains/IPs, anchors, pages, authority-score trend) and keyword metrics via the Semrush v4 REST API.',
  auth: {
    kind: 'api-key',
    hint: 'Semrush API key from Subscription info → API units. Sent as the `Authorization: Apikey <key>` header.',
  },
  category: 'market-intelligence',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://api.semrush.com',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Apikey ' },
  capabilities: [
    {
      name: 'backlinks.overview',
      class: 'read',
      description:
        'Aggregated backlink metrics for a target: total backlinks, referring domains, authority score, follow/nofollow split, referring IPs.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target host, subdomain, folder, or page, e.g. semrush.com.' },
          scope: {
            type: 'string',
            description: 'Which part of the URL to analyze: ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.',
          },
          fields: { type: 'string', description: 'Comma-separated subset of response fields (all by default).' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/overview',
        query: { url: '{url}', scope: '{scope}', fields: '{fields}' },
      },
    },
    {
      name: 'backlinks.summary',
      class: 'read',
      description:
        'Monthly historical trend of authority score, backlinks count, and referring domains. date_from/date_to are YYYY-MM.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Target host/subdomain/folder/page.' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          date_from: { type: 'string', description: 'Start month, YYYY-MM.' },
          date_to: { type: 'string', description: 'End month, YYYY-MM.' },
          fields: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/summary',
        query: {
          url: '{url}',
          scope: '{scope}',
          date_from: '{date_from}',
          date_to: '{date_to}',
          fields: '{fields}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'backlinks.links',
      class: 'read',
      description:
        'Paginated list of individual backlinks: anchor text, source/target URLs, domain & page authority, follow/nofollow, first/last seen.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
          order_by: { type: 'string', description: 'Field to sort by.' },
          direction: { type: 'string', description: 'ASC | DESC.' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          filter: { type: 'string', description: 'Field-operator-value filter expression, e.g. is_follow=1.' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/links',
        query: {
          url: '{url}',
          scope: '{scope}',
          fields: '{fields}',
          order_by: '{order_by}',
          direction: '{direction}',
          limit: '{limit}',
          offset: '{offset}',
          filter: '{filter}',
        },
      },
    },
    {
      name: 'backlinks.ref_domains',
      class: 'read',
      description:
        'Referring domains with per-domain backlink counts, domain authority score, country, IP, and follow/new/lost status.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
          order_by: { type: 'string' },
          direction: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          filter: { type: 'string' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/ref-domains',
        query: {
          url: '{url}',
          scope: '{scope}',
          fields: '{fields}',
          order_by: '{order_by}',
          direction: '{direction}',
          limit: '{limit}',
          offset: '{offset}',
          filter: '{filter}',
        },
      },
    },
    {
      name: 'backlinks.ref_ips',
      class: 'read',
      description: 'Referring IP addresses with backlink count, referring-domain count, and country.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
          order_by: { type: 'string' },
          direction: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/ref-ips',
        query: {
          url: '{url}',
          scope: '{scope}',
          fields: '{fields}',
          order_by: '{order_by}',
          direction: '{direction}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'backlinks.anchors',
      class: 'read',
      description:
        'Backlink anchor texts with per-anchor backlink count, referring domains, and domain/page authority scores.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
          order_by: { type: 'string' },
          direction: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/anchors',
        query: {
          url: '{url}',
          scope: '{scope}',
          fields: '{fields}',
          order_by: '{order_by}',
          direction: '{direction}',
          limit: '{limit}',
          offset: '{offset}',
        },
      },
    },
    {
      name: 'backlinks.pages',
      class: 'read',
      description: 'Pages on the target domain that receive backlinks, with per-page backlink and referring-domain counts.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
          order_by: { type: 'string' },
          direction: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
          filter: { type: 'string' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/pages',
        query: {
          url: '{url}',
          scope: '{scope}',
          fields: '{fields}',
          order_by: '{order_by}',
          direction: '{direction}',
          limit: '{limit}',
          offset: '{offset}',
          filter: '{filter}',
        },
      },
    },
    {
      name: 'backlinks.score_profile',
      class: 'read',
      description: 'Authority Score distribution of a target’s backlink profile — the breakdown of backlink quality scores.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | SUBFOLDER | PAGE.' },
          fields: { type: 'string' },
        },
        required: ['url', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/score-profile',
        query: { url: '{url}', scope: '{scope}', fields: '{fields}' },
      },
    },
    {
      name: 'backlinks.comparison',
      class: 'read',
      description:
        'Compare the backlink profiles of up to 10 targets side by side. `urls` is comma-separated; scope here supports ROOT_DOMAIN | SUBDOMAIN | PAGE only (no SUBFOLDER).',
      parameters: {
        type: 'object',
        properties: {
          urls: { type: 'string', description: 'Comma-separated list of up to 10 target URLs.' },
          scope: { type: 'string', description: 'ROOT_DOMAIN | SUBDOMAIN | PAGE.' },
          fields: { type: 'string' },
        },
        required: ['urls', 'scope'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/backlinks/v1/comparison',
        query: { urls: '{urls}', scope: '{scope}', fields: '{fields}' },
      },
    },
    {
      name: 'keyword.metrics',
      class: 'read',
      description:
        'Keyword metrics for a single keyword (Semrush v4 keyword surface): search volume, CPC, keyword difficulty, competition, trend, SERP features, and search intent.',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'The keyword phrase to look up.' },
          country: { type: 'string', description: 'Database/country code, e.g. us, uk, de.' },
          month: { type: 'string', description: 'Optional month for the metric snapshot, YYYY-MM.' },
        },
        required: ['keyword', 'country'],
      },
      request: {
        method: 'GET',
        path: '/apis/v4/keywords/v1/metrics',
        query: { keyword: '{keyword}', country: '{country}', month: '{month}' },
      },
    },
  ],
})
