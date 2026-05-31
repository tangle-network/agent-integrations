import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Analytics (GA4) — read-only analytics surface.
 *
 * Auth model: standard Google OAuth2. The Analytics Data API v1 and Analytics
 * Admin API v1 both honour the same `analytics.readonly` scope for read access
 * to GA4 properties. We request the narrower readonly scope so the consent
 * screen is honest about what the agent will and will not do; this connector
 * never writes to GA4 (GA4 is fundamentally an ingest pipeline — events come
 * in through gtag/Measurement Protocol, not the management API), so requesting
 * a write scope here would just dilute the consent prompt.
 *
 * API routing: GA4 splits its surface across two hostnames:
 *   - https://analyticsdata.googleapis.com  → Data API (reports, realtime)
 *   - https://analyticsadmin.googleapis.com → Admin API (accounts, properties)
 *
 * The declarative-rest runtime takes a single baseUrl. We pin it to the Data
 * API host (the primary agent-relevant case is "pull a report") and use
 * absolute URLs in the path for the handful of Admin endpoints we expose
 * (account / property discovery). `new URL(absolute, base)` honours the
 * absolute URL, so this composes cleanly without forking the runtime.
 *
 * Property identifier: every Data API endpoint is keyed by a GA4 property,
 * referenced as `properties/{propertyId}` where `propertyId` is the numeric
 * property id visible in the GA4 admin UI (Property Settings → Property ID).
 * Capabilities accept the bare numeric id; the adapter renders the
 * `properties/{id}` prefix into the URL.
 *
 * Universal Analytics (UA) is end-of-life as of 2023 and its Reporting API v4
 * (analyticsreporting.googleapis.com) is gone. This adapter is GA4-only by
 * construction — no UA fallback, no silent compatibility shim. A customer
 * still running UA needs to migrate the property to GA4 before connecting.
 */
export const googleAnalyticsConnector = declarativeRestConnector({
  kind: 'google-analytics',
  displayName: 'Google Analytics',
  description:
    'Run reports, pivot reports, realtime reports, and batch reports against connected GA4 properties. Read-only: GA4 ingest happens through gtag / Measurement Protocol, not the management API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  category: 'database',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://analyticsdata.googleapis.com',
  // accountSummaries.list lives on the Admin API host and is the cheapest
  // probe that confirms the token can reach GA4 at all. Absolute URL routes
  // around the single-baseUrl constraint of the declarative-rest runtime.
  test: {
    method: 'GET',
    path: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
    query: { pageSize: 1 },
  },
  capabilities: [
    {
      name: 'accountSummaries.list',
      class: 'read',
      description:
        'List GA4 account summaries reachable by the connected identity. Each summary nests its properties so the agent can discover propertyId values without a second round-trip (GET analyticsadmin.googleapis.com/v1beta/accountSummaries).',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 200, description: 'Max account summaries per page; server caps at 200.' },
          pageToken: { type: 'string', description: 'Continuation token returned by a prior call.' },
        },
      },
      request: {
        method: 'GET',
        path: 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries',
        query: { pageSize: '{pageSize}', pageToken: '{pageToken}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.get',
      class: 'read',
      description: 'Fetch GA4 property settings (display name, timezone, currency, industry) by numeric property id (GET analyticsadmin.googleapis.com/v1beta/properties/{propertyId}).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id, e.g. "123456789".' },
        },
        required: ['propertyId'],
      },
      request: {
        method: 'GET',
        path: 'https://analyticsadmin.googleapis.com/v1beta/properties/{propertyId}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.metadata.get',
      class: 'read',
      description:
        'List every dimension and metric available on a GA4 property, including custom dimensions/metrics defined by the customer. Use this before runReport to discover valid dimension/metric names (GET /v1beta/properties/{propertyId}/metadata).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
        },
        required: ['propertyId'],
      },
      request: {
        method: 'GET',
        path: '/v1beta/properties/{propertyId}/metadata',
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.runReport',
      class: 'read',
      description:
        'Run a core report against a GA4 property. Pass dimensions, metrics, dateRanges (e.g. {startDate:"7daysAgo",endDate:"today"}), optional filters, ordering, and a row limit. Returns the rows, totals, and metadata GA4 emits in the standard runReport response (POST /v1beta/properties/{propertyId}:runReport).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
          dimensions: {
            type: 'array',
            description: 'Dimension specs, e.g. [{ "name": "country" }, { "name": "deviceCategory" }].',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                dimensionExpression: { type: 'object', description: 'Composite/lower-case/concatenate expression (optional).' },
              },
              required: ['name'],
            },
          },
          metrics: {
            type: 'array',
            description: 'Metric specs, e.g. [{ "name": "activeUsers" }, { "name": "sessions" }].',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                expression: { type: 'string', description: 'Derived metric expression (optional).' },
                invisible: { type: 'boolean' },
              },
              required: ['name'],
            },
          },
          dateRanges: {
            type: 'array',
            description: 'One or two date ranges; GA4 accepts ISO dates ("2026-05-01"), "today", "yesterday", or "NdaysAgo".',
            items: {
              type: 'object',
              properties: {
                startDate: { type: 'string' },
                endDate: { type: 'string' },
                name: { type: 'string', description: 'Optional label included in the response row keys when comparing two ranges.' },
              },
              required: ['startDate', 'endDate'],
            },
          },
          dimensionFilter: { type: 'object', description: 'GA4 FilterExpression (and/or/not) applied to dimensions.' },
          metricFilter: { type: 'object', description: 'GA4 FilterExpression applied to metrics after aggregation.' },
          orderBys: { type: 'array', items: { type: 'object' } },
          limit: { type: 'integer', minimum: 1, maximum: 250000, description: 'Max rows per page; GA4 caps at 250000.' },
          offset: { type: 'integer', minimum: 0 },
          keepEmptyRows: { type: 'boolean' },
          returnPropertyQuota: { type: 'boolean', description: 'Include per-property quota consumption in the response — useful for back-pressure decisions.' },
          currencyCode: { type: 'string', description: 'ISO-4217 currency, overrides the property default for monetary metrics.' },
          cohortSpec: { type: 'object', description: 'CohortSpec for cohort analysis (optional).' },
        },
        required: ['propertyId', 'metrics', 'dateRanges'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/properties/{propertyId}:runReport',
        body: {
          dimensions: '{dimensions}',
          metrics: '{metrics}',
          dateRanges: '{dateRanges}',
          dimensionFilter: '{dimensionFilter}',
          metricFilter: '{metricFilter}',
          orderBys: '{orderBys}',
          limit: '{limit}',
          offset: '{offset}',
          keepEmptyRows: '{keepEmptyRows}',
          returnPropertyQuota: '{returnPropertyQuota}',
          currencyCode: '{currencyCode}',
          cohortSpec: '{cohortSpec}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.batchRunReports',
      class: 'read',
      description:
        'Run up to 5 reports against the same GA4 property in a single request — cheaper than 5 round-trips and counted as fewer quota tokens (POST /v1beta/properties/{propertyId}:batchRunReports).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
          requests: {
            type: 'array',
            description: 'Up to 5 report requests; each takes the same shape as runReport (dimensions/metrics/dateRanges/etc.).',
            items: { type: 'object' },
            maxItems: 5,
          },
        },
        required: ['propertyId', 'requests'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/properties/{propertyId}:batchRunReports',
        body: { requests: '{requests}' },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.runPivotReport',
      class: 'read',
      description:
        'Run a pivot report — like runReport but with one or more pivot specifications that rotate dimensions into columns (POST /v1beta/properties/{propertyId}:runPivotReport).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
          dimensions: { type: 'array', items: { type: 'object' } },
          metrics: { type: 'array', items: { type: 'object' } },
          dateRanges: { type: 'array', items: { type: 'object' } },
          pivots: {
            type: 'array',
            description: 'Pivot specifications — each names the dimensions to pivot, an order, a limit, and optional offset.',
            items: {
              type: 'object',
              properties: {
                fieldNames: { type: 'array', items: { type: 'string' } },
                orderBys: { type: 'array', items: { type: 'object' } },
                offset: { type: 'string', description: 'String-encoded long.' },
                limit: { type: 'string', description: 'String-encoded long.' },
                metricAggregations: { type: 'array', items: { type: 'string' } },
              },
              required: ['fieldNames'],
            },
          },
          dimensionFilter: { type: 'object' },
          metricFilter: { type: 'object' },
          currencyCode: { type: 'string' },
          cohortSpec: { type: 'object' },
          keepEmptyRows: { type: 'boolean' },
          returnPropertyQuota: { type: 'boolean' },
        },
        required: ['propertyId', 'metrics', 'dateRanges', 'pivots'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/properties/{propertyId}:runPivotReport',
        body: {
          dimensions: '{dimensions}',
          metrics: '{metrics}',
          dateRanges: '{dateRanges}',
          pivots: '{pivots}',
          dimensionFilter: '{dimensionFilter}',
          metricFilter: '{metricFilter}',
          currencyCode: '{currencyCode}',
          cohortSpec: '{cohortSpec}',
          keepEmptyRows: '{keepEmptyRows}',
          returnPropertyQuota: '{returnPropertyQuota}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.runRealtimeReport',
      class: 'read',
      description:
        'Run a realtime report — surfaces events that happened in the last 30 minutes. No dateRanges; the realtime window is implicit (POST /v1beta/properties/{propertyId}:runRealtimeReport).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
          dimensions: { type: 'array', items: { type: 'object' } },
          metrics: { type: 'array', items: { type: 'object' } },
          dimensionFilter: { type: 'object' },
          metricFilter: { type: 'object' },
          limit: { type: 'integer', minimum: 1, maximum: 250000 },
          metricAggregations: { type: 'array', items: { type: 'string' } },
          orderBys: { type: 'array', items: { type: 'object' } },
          returnPropertyQuota: { type: 'boolean' },
          minuteRanges: {
            type: 'array',
            description: 'Optional minute-window specifications, e.g. [{ "name": "last5", "startMinutesAgo": 5, "endMinutesAgo": 0 }]. Defaults to the last 30 minutes.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                startMinutesAgo: { type: 'integer', minimum: 0, maximum: 29 },
                endMinutesAgo: { type: 'integer', minimum: 0, maximum: 29 },
              },
            },
          },
        },
        required: ['propertyId', 'metrics'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/properties/{propertyId}:runRealtimeReport',
        body: {
          dimensions: '{dimensions}',
          metrics: '{metrics}',
          dimensionFilter: '{dimensionFilter}',
          metricFilter: '{metricFilter}',
          limit: '{limit}',
          metricAggregations: '{metricAggregations}',
          orderBys: '{orderBys}',
          returnPropertyQuota: '{returnPropertyQuota}',
          minuteRanges: '{minuteRanges}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
    {
      name: 'properties.checkCompatibility',
      class: 'read',
      description:
        'Check whether a given dimension/metric combination is compatible before issuing a full runReport — GA4 rejects incompatible combos (e.g. cohort dimensions with non-cohort metrics) with a hard error (POST /v1beta/properties/{propertyId}:checkCompatibility).',
      parameters: {
        type: 'object',
        properties: {
          propertyId: { type: 'string', description: 'Numeric GA4 property id.' },
          dimensions: { type: 'array', items: { type: 'object' } },
          metrics: { type: 'array', items: { type: 'object' } },
          dimensionFilter: { type: 'object' },
          metricFilter: { type: 'object' },
          compatibilityFilter: {
            type: 'string',
            enum: ['COMPATIBILITY_UNSPECIFIED', 'COMPATIBLE', 'INCOMPATIBLE'],
            description: 'Restrict the response to compatible or incompatible entries only.',
          },
        },
        required: ['propertyId'],
      },
      request: {
        method: 'POST',
        path: '/v1beta/properties/{propertyId}:checkCompatibility',
        body: {
          dimensions: '{dimensions}',
          metrics: '{metrics}',
          dimensionFilter: '{dimensionFilter}',
          metricFilter: '{metricFilter}',
          compatibilityFilter: '{compatibilityFilter}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    },
  ],
})
