import { declarativeRestConnector } from './declarative-rest.js'

const date = {
  type: 'string',
  pattern: '^[0-9]{8}$',
  description: 'Inclusive date in YYYYMMDD format.',
} as const

const isoTimestamp = {
  type: 'string',
  description: 'ISO 8601 timestamp with a time-zone offset.',
} as const

const annotationId = {
  annotationId: { type: 'integer', minimum: 1, description: 'Amplitude annotation ID.' },
}

const categoryId = {
  categoryId: { type: 'integer', minimum: 1, description: 'Amplitude annotation category ID.' },
}

const annotation = {
  type: 'object',
  properties: {
    label: { type: 'string', minLength: 1 },
    start: isoTimestamp,
    category: { type: 'string' },
    chart_id: { type: ['string', 'null'] },
    details: { type: 'string' },
    end: { ...isoTimestamp, type: ['string', 'null'] },
  },
  required: ['label', 'start'],
  additionalProperties: false,
} as const

/**
 * Amplitude Analytics — project-scoped Dashboard and Chart Annotations APIs.
 *
 * Amplitude issues an API key and secret key for each project. These APIs use
 * that pair as HTTP Basic credentials. The write surface intentionally stays
 * inside the same documented credential boundary: chart annotations and their
 * categories. Event ingestion uses different endpoints and operational rules,
 * so it does not belong in this analytics connection.
 */
export const amplitudeConnector = declarativeRestConnector({
  kind: 'amplitude',
  displayName: 'Amplitude',
  description:
    'Query project analytics and manage chart annotations with Amplitude project API credentials.',
  auth: {
    kind: 'api-key',
    hint: 'JSON credential bundle: {"apiKey":"...","secretKey":"..."} from Project Settings → General. Set metadata.apiBaseUrl to https://analytics.eu.amplitude.com only for an EU-resident project; the default is https://amplitude.com.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://amplitude.com' },
  allowedBaseUrls: ['https://amplitude.com', 'https://analytics.eu.amplitude.com'],
  credentialPlacement: {
    kind: 'basic-structured',
    usernameField: 'apiKey',
    passwordField: 'secretKey',
  },
  test: { method: 'GET', path: '/api/2/events/list' },
  capabilities: [
    {
      name: 'events.list',
      class: 'read',
      description: 'List visible project events with current-week totals, uniques, and daily-active-user share.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/2/events/list' },
    },
    {
      name: 'events.segment',
      class: 'read',
      description: 'Query event totals, uniques, percentages, averages, or formulas over a date range.',
      parameters: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            description: 'JSON event definition, for example {"event_type":"_active"}.',
          },
          secondEvent: { type: 'string', description: 'Optional second JSON event definition.' },
          metric: {
            type: 'string',
            enum: ['uniques', 'totals', 'pct_dau', 'average', 'histogram', 'sums', 'value_avg', 'formula'],
          },
          activeUserType: { type: 'string', enum: ['any', 'active'] },
          start: date,
          end: date,
          interval: { type: 'integer', enum: [-300000, -3600000, 1, 7, 30] },
          segment: { type: 'string', description: 'JSON array of Amplitude segment definitions.' },
          groupBy: { type: 'string' },
          secondGroupBy: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
          formula: { type: 'string' },
          rollingWindow: { type: 'integer', minimum: 1 },
          rollingAverage: { type: 'integer', minimum: 1 },
        },
        required: ['event', 'start', 'end'],
      },
      request: {
        method: 'GET',
        path: '/api/2/events/segmentation',
        query: {
          e: '{event}',
          e2: '{secondEvent}',
          m: '{metric}',
          n: '{activeUserType}',
          start: '{start}',
          end: '{end}',
          i: '{interval}',
          s: '{segment}',
          g: '{groupBy}',
          g2: '{secondGroupBy}',
          limit: '{limit}',
          formula: '{formula}',
          rollingWindow: '{rollingWindow}',
          rollingAverage: '{rollingAverage}',
        },
      },
    },
    {
      name: 'users.counts',
      class: 'read',
      description: 'Get active or new user counts over a date range.',
      parameters: {
        type: 'object',
        properties: {
          start: date,
          end: date,
          mode: { type: 'string', enum: ['active', 'new'] },
          interval: { type: 'integer', enum: [1, 7, 30] },
          segment: { type: 'string', description: 'JSON array of Amplitude segment definitions.' },
          groupBy: { type: 'string' },
        },
        required: ['start', 'end'],
      },
      request: {
        method: 'GET',
        path: '/api/2/users',
        query: {
          start: '{start}',
          end: '{end}',
          m: '{mode}',
          i: '{interval}',
          s: '{segment}',
          g: '{groupBy}',
        },
      },
    },
    {
      name: 'sessions.average-length',
      class: 'read',
      description: 'Get average session length in seconds for each day in a date range.',
      parameters: {
        type: 'object',
        properties: { start: date, end: date },
        required: ['start', 'end'],
      },
      request: {
        method: 'GET',
        path: '/api/2/sessions/average',
        query: { start: '{start}', end: '{end}' },
      },
    },
    {
      name: 'users.search',
      class: 'read',
      description: 'Search for a user by Amplitude ID, device ID, user ID, or user ID prefix.',
      parameters: {
        type: 'object',
        properties: { user: { type: 'string', minLength: 1 } },
        required: ['user'],
      },
      request: { method: 'GET', path: '/api/2/usersearch', query: { user: '{user}' } },
    },
    {
      name: 'users.activity',
      class: 'read',
      description: 'Read one user summary and a bounded window of recent or earliest events.',
      parameters: {
        type: 'object',
        properties: {
          user: { type: 'string', minLength: 1, description: 'Amplitude user ID.' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 0, maximum: 1000 },
          direction: { type: 'string', enum: ['earliest', 'latest'] },
        },
        required: ['user'],
      },
      request: {
        method: 'GET',
        path: '/api/2/useractivity',
        query: { user: '{user}', offset: '{offset}', limit: '{limit}', direction: '{direction}' },
      },
    },
    {
      name: 'charts.results',
      class: 'read',
      description: 'Export results from one saved Amplitude chart by chart ID.',
      parameters: {
        type: 'object',
        properties: { chartId: { type: 'string', minLength: 1 } },
        required: ['chartId'],
      },
      request: { method: 'GET', path: '/api/3/chart/{chartId}/csv' },
    },
    {
      name: 'annotations.list',
      class: 'read',
      description: 'List project chart annotations with optional category, chart, and date filters.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          chartId: { type: 'string' },
          start: isoTimestamp,
          end: isoTimestamp,
        },
      },
      request: {
        method: 'GET',
        path: '/api/3/annotations',
        query: { category: '{category}', chart_id: '{chartId}', start: '{start}', end: '{end}' },
      },
    },
    {
      name: 'annotations.get',
      class: 'read',
      description: 'Read one chart annotation by ID.',
      parameters: { type: 'object', properties: annotationId, required: ['annotationId'] },
      request: { method: 'GET', path: '/api/3/annotations/{annotationId}' },
    },
    {
      name: 'annotations.create',
      class: 'mutation',
      description: 'Create a project-wide or chart-specific annotation.',
      parameters: {
        type: 'object',
        properties: { annotation },
        required: ['annotation'],
      },
      request: { method: 'POST', path: '/api/3/annotations', body: '{annotation}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'annotations.update',
      class: 'mutation',
      description: 'Partially update one annotation.',
      parameters: {
        type: 'object',
        properties: {
          ...annotationId,
          changes: {
            ...annotation,
            required: [],
          },
        },
        required: ['annotationId', 'changes'],
      },
      request: { method: 'PUT', path: '/api/3/annotations/{annotationId}', body: '{changes}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'annotations.delete',
      class: 'mutation',
      description: 'Permanently delete one annotation.',
      parameters: { type: 'object', properties: annotationId, required: ['annotationId'] },
      request: { method: 'DELETE', path: '/api/3/annotations/{annotationId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'annotation-categories.list',
      class: 'read',
      description: 'List annotation categories or filter by exact category name.',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/api/3/annotation-categories',
        query: { category: '{category}' },
      },
    },
    {
      name: 'annotation-categories.get',
      class: 'read',
      description: 'Read one annotation category by ID.',
      parameters: { type: 'object', properties: categoryId, required: ['categoryId'] },
      request: { method: 'GET', path: '/api/3/annotation-categories/{categoryId}' },
    },
    {
      name: 'annotation-categories.create',
      class: 'mutation',
      description: 'Create an annotation category.',
      parameters: {
        type: 'object',
        properties: { category: { type: 'string', minLength: 1 } },
        required: ['category'],
      },
      request: {
        method: 'POST',
        path: '/api/3/annotation-categories',
        body: { category: '{category}' },
      },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'annotation-categories.update',
      class: 'mutation',
      description: 'Rename one annotation category.',
      parameters: {
        type: 'object',
        properties: { ...categoryId, category: { type: 'string', minLength: 1 } },
        required: ['categoryId', 'category'],
      },
      request: {
        method: 'PUT',
        path: '/api/3/annotation-categories/{categoryId}',
        body: { category: '{category}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'annotation-categories.delete',
      class: 'mutation',
      description: 'Permanently delete one annotation category.',
      parameters: { type: 'object', properties: categoryId, required: ['categoryId'] },
      request: { method: 'DELETE', path: '/api/3/annotation-categories/{categoryId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
