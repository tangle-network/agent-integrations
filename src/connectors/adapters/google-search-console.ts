import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Search Console — site verification, sitemap management, search analytics,
 * and URL inspection over the Webmasters / Search Console API.
 *
 * Auth model: standard Google OAuth2 with the `webmasters` scope. Search Console
 * exposes two scopes: `webmasters.readonly` (read everything) and `webmasters`
 * (read + sitemap management + site add/delete). The activepieces piece covers
 * destructive actions (addSite, deleteSite, submitSitemap), so we request the
 * full `webmasters` scope. URL Inspection has its own implicit grant: the
 * inspection endpoint requires `webmasters.readonly` at minimum, and the
 * `webmasters` scope is a superset.
 *
 * Site identifier: every Search Console endpoint is keyed by a `siteUrl` —
 * either a URL-prefix property (e.g. `https://example.com/`) or a domain
 * property (e.g. `sc-domain:example.com`). The literal string is encoded into
 * the path segment; callers pass it verbatim and the declarative-rest runtime
 * URL-encodes the path segment substitution.
 *
 * Consistency: Search Console is an analytics surface backed by Google's
 * indexing pipeline. Search Analytics data is typically delayed 2–3 days and
 * the URL inspection result reflects the last time Googlebot crawled the URL,
 * so we mark this connector as `cache` — agents should not treat its output
 * as a real-time mirror of the live site.
 */
export const googleSearchConsoleConnector = declarativeRestConnector({
  kind: 'google-search-console',
  displayName: 'Google Search Console',
  description:
    'Inspect URLs against the Google index, run Search Analytics queries, and manage verified sites and sitemaps for properties the connected identity owns in Google Search Console.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/webmasters'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://searchconsole.googleapis.com',
  // sites.list is the cheapest probe that confirms the token can reach Search
  // Console and is scoped correctly. It returns the verified property list,
  // which is what every other capability is keyed by.
  test: { method: 'GET', path: '/webmasters/v3/sites' },
  capabilities: [
    {
      name: 'urlInspection.index',
      class: 'read',
      description:
        'Inspect a URL against the Google index for a property in Search Console. Returns the indexing status, last crawl time, canonical URL, mobile usability, rich results status, and AMP analysis (POST /v1/urlInspection/index:inspect).',
      parameters: {
        type: 'object',
        properties: {
          inspectionUrl: {
            type: 'string',
            description: 'Fully-qualified URL to inspect. Must belong to the verified `siteUrl` property below.',
          },
          siteUrl: {
            type: 'string',
            description:
              'Verified property the inspectionUrl belongs to. URL-prefix property (e.g. "https://example.com/") or domain property ("sc-domain:example.com").',
          },
          languageCode: {
            type: 'string',
            description: 'BCP-47 language code (e.g. "en-US") that controls the locale of human-readable strings in the response.',
          },
        },
        required: ['inspectionUrl', 'siteUrl'],
      },
      request: {
        method: 'POST',
        path: '/v1/urlInspection/index:inspect',
        body: {
          inspectionUrl: '{inspectionUrl}',
          siteUrl: '{siteUrl}',
          languageCode: '{languageCode}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'searchAnalytics.query',
      class: 'read',
      description:
        'Run a Search Analytics query against a verified property. Pass startDate/endDate (ISO yyyy-MM-dd), optional dimensions (query, page, country, device, searchAppearance, date), filter groups, row limit, and aggregation type. Returns the rows Search Console emits with clicks, impressions, CTR, and average position (POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query).',
      parameters: {
        type: 'object',
        properties: {
          siteUrl: {
            type: 'string',
            description: 'Verified property identifier — URL-prefix or "sc-domain:" form.',
          },
          startDate: { type: 'string', description: 'Inclusive start date, ISO yyyy-MM-dd. Search Console data lags 2–3 days.' },
          endDate: { type: 'string', description: 'Inclusive end date, ISO yyyy-MM-dd.' },
          dimensions: {
            type: 'array',
            description: 'Group-by dimensions, e.g. ["query","page"]. Omit for a single totals row.',
            items: {
              type: 'string',
              enum: ['query', 'page', 'country', 'device', 'searchAppearance', 'date'],
            },
          },
          type: {
            type: 'string',
            description: 'Search type filter: "web" (default), "image", "video", "news", "discover", "googleNews".',
            enum: ['web', 'image', 'video', 'news', 'discover', 'googleNews'],
          },
          dimensionFilterGroups: {
            type: 'array',
            description: 'OR-grouped filters; each group is an AND of dimension/expression/operator filters.',
            items: { type: 'object' },
          },
          aggregationType: {
            type: 'string',
            description: '"auto" (default) chooses byPage/byProperty per dimension set; "byPage" forces per-page aggregation.',
            enum: ['auto', 'byPage', 'byProperty', 'byNewsShowcasePanel'],
          },
          rowLimit: { type: 'integer', minimum: 1, maximum: 25000, description: 'Max rows per page; Search Console caps at 25000.' },
          startRow: { type: 'integer', minimum: 0, description: 'Zero-based offset for pagination.' },
          dataState: {
            type: 'string',
            description: '"final" (default, fully processed) or "all" (includes fresh-but-incomplete data from the last 1–2 days).',
            enum: ['final', 'all'],
          },
        },
        required: ['siteUrl', 'startDate', 'endDate'],
      },
      request: {
        method: 'POST',
        path: '/webmasters/v3/sites/{siteUrl}/searchAnalytics/query',
        body: {
          startDate: '{startDate}',
          endDate: '{endDate}',
          dimensions: '{dimensions}',
          type: '{type}',
          dimensionFilterGroups: '{dimensionFilterGroups}',
          aggregationType: '{aggregationType}',
          rowLimit: '{rowLimit}',
          startRow: '{startRow}',
          dataState: '{dataState}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'sites.list',
      class: 'read',
      description:
        'List every site the connected identity has at least read access to in Search Console. Returns the siteUrl identifiers other capabilities consume, plus the permissionLevel per site (GET /webmasters/v3/sites).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/webmasters/v3/sites' },
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'sites.add',
      class: 'mutation',
      description:
        'Add a site to the connected identity\'s Search Console account. The site will be unverified until ownership is proven through one of Search Console\'s verification methods (PUT /webmasters/v3/sites/{siteUrl}).',
      parameters: {
        type: 'object',
        properties: {
          siteUrl: {
            type: 'string',
            description: 'URL-prefix property ("https://example.com/") or domain property ("sc-domain:example.com") to add.',
          },
        },
        required: ['siteUrl'],
      },
      request: { method: 'PUT', path: '/webmasters/v3/sites/{siteUrl}' },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'sites.delete',
      class: 'mutation',
      description:
        'Remove a site from the connected identity\'s Search Console account. The site itself is not affected; only the connected identity\'s access is revoked (DELETE /webmasters/v3/sites/{siteUrl}).',
      parameters: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'Property identifier to remove — URL-prefix or "sc-domain:" form.' },
        },
        required: ['siteUrl'],
      },
      request: { method: 'DELETE', path: '/webmasters/v3/sites/{siteUrl}' },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'sitemaps.list',
      class: 'read',
      description:
        'List every sitemap registered against a verified property in Search Console. Returns each sitemap\'s path, last-submitted time, last-downloaded time, type (sitemap/sitemapsIndex), and any errors/warnings (GET /webmasters/v3/sites/{siteUrl}/sitemaps).',
      parameters: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'Verified property identifier.' },
          sitemapIndex: {
            type: 'string',
            description: 'Optional sitemap-index URL; if set, only sitemaps contained within that index are returned.',
          },
        },
        required: ['siteUrl'],
      },
      request: {
        method: 'GET',
        path: '/webmasters/v3/sites/{siteUrl}/sitemaps',
        query: { sitemapIndex: '{sitemapIndex}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
    {
      name: 'sitemaps.submit',
      class: 'mutation',
      description:
        'Submit a sitemap to Search Console for a verified property. The feedPath must be a fully-qualified URL hosted on the site; Search Console fetches it asynchronously after the call returns (PUT /webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}).',
      parameters: {
        type: 'object',
        properties: {
          siteUrl: { type: 'string', description: 'Verified property identifier the sitemap belongs to.' },
          feedpath: {
            type: 'string',
            description: 'Fully-qualified sitemap URL, e.g. "https://example.com/sitemap.xml". The runtime URL-encodes this when substituting into the path.',
          },
        },
        required: ['siteUrl', 'feedpath'],
      },
      request: { method: 'PUT', path: '/webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}' },
      cas: 'native-idempotency',
      requiredScopes: ['https://www.googleapis.com/auth/webmasters'],
    },
  ],
})
