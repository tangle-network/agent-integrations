import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Datadog — observability ingest surface (logs, metrics, events, service
 * checks, validation).
 *
 * Auth model: Datadog uses two distinct credential headers — `DD-API-KEY`
 * (org-scoped, identifies which Datadog account to bill / route to) and
 * `DD-APPLICATION-KEY` (user-scoped, grants per-user RBAC across the
 * management surface: monitors, dashboards, queries, downtimes, etc.). The
 * declarative-rest runtime in this codebase carries exactly one credential
 * per connection; modelling Datadog's full dual-key management surface here
 * would require either packing both keys into one apiKey string (silently
 * coupled and easy to misconfigure) or extending the framework's credential
 * placement model. This adapter intentionally scopes itself to the
 * single-header surface that takes only DD-API-KEY:
 *
 *   - POST /api/v2/logs            — log ingest
 *   - POST /api/v2/series          — metric submission (v2)
 *   - POST /api/v1/series          — metric submission (v1)
 *   - POST /api/v1/distribution_points
 *   - POST /api/v1/events          — post a custom event
 *   - GET  /api/v1/events          — list events (DD-API-KEY only)
 *   - POST /api/v1/check_run       — service check status
 *   - GET  /api/v1/validate        — auth probe
 *
 * That set covers the agent-relevant case "push observability data into
 * Datadog" cleanly and honestly. A separate `datadog-management` adapter is
 * the right home for the DD-APPLICATION-KEY surface (monitors, dashboards,
 * incidents, logs/metrics query). Do not silently extend this connector with
 * endpoints that require DD-APPLICATION-KEY — they will return 403 at
 * runtime and corrupt every signal downstream.
 *
 * Site routing: Datadog runs eight isolated regions (US1, US3, US5, EU,
 * AP1, US1-FED, and the legacy US-LEGACY datadoghq.com). Each has its own
 * intake hostname; the per-tenant intake URL lives on metadata.intakeUrl
 * (e.g. https://api.datadoghq.com, https://api.us3.datadoghq.com,
 * https://api.datadoghq.eu, https://api.ddog-gov.com, https://api.ap1.datadoghq.com).
 * No fallback — a misconfigured connection fails loud at first invocation
 * rather than silently shipping logs to the wrong region's compliance
 * boundary.
 */
export const datadogConnector = declarativeRestConnector({
  kind: 'datadog',
  displayName: 'Datadog',
  description:
    'Submit logs, metrics, events, and service checks to Datadog (DD-API-KEY ingest surface). The DD-APPLICATION-KEY-gated management surface (monitors, dashboards, query) is intentionally out of scope.',
  auth: {
    kind: 'api-key',
    hint: 'Datadog DD-API-KEY (Organization Settings → API Keys). Also set metadata.intakeUrl to the regional intake host for your Datadog site (e.g. https://api.datadoghq.com for US1, https://api.datadoghq.eu for EU, https://api.us3.datadoghq.com for US3, https://api.us5.datadoghq.com for US5, https://api.ap1.datadoghq.com for AP1, https://api.ddog-gov.com for US1-FED).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'intakeUrl' },
  credentialPlacement: { kind: 'header', header: 'DD-API-KEY', prefix: '' },
  defaultHeaders: { accept: 'application/json' },
  test: { method: 'GET', path: '/api/v1/validate' },
  capabilities: [
    {
      name: 'auth.validate',
      class: 'read',
      description: 'Probe credentials against the Datadog API (GET /api/v1/validate).',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/api/v1/validate' },
    },
    {
      name: 'logs.submit',
      class: 'mutation',
      description:
        'Send one or more structured log entries to Datadog Logs (POST /api/v2/logs). Each entry takes ddsource, ddtags, hostname, message, service, and any additional structured attributes.',
      parameters: {
        type: 'object',
        properties: {
          logs: {
            type: 'array',
            description: 'Array of log entries. Datadog accepts up to 1000 entries or 5 MB per request.',
            items: {
              type: 'object',
              properties: {
                ddsource: { type: 'string', description: 'The integration name (e.g. nginx, agent-runtime).' },
                ddtags: { type: 'string', description: 'Comma-separated tag list (env:prod,team:foo).' },
                hostname: { type: 'string' },
                message: { type: 'string', description: 'Log body. JSON-encoded strings are parsed into structured attributes.' },
                service: { type: 'string' },
              },
              required: ['message'],
              additionalProperties: true,
            },
          },
        },
        required: ['logs'],
      },
      request: { method: 'POST', path: '/api/v2/logs', body: '{logs}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'metrics.submit',
      class: 'mutation',
      description:
        'Submit metric series points to Datadog (POST /api/v2/series). Each series carries metric name, type, unit, points, resources, and tags.',
      parameters: {
        type: 'object',
        properties: {
          series: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                metric: { type: 'string', description: 'Dot-delimited metric name (e.g. system.cpu.user).' },
                type: {
                  type: 'integer',
                  description:
                    'Metric intake type: 0=unspecified, 1=count, 2=rate, 3=gauge. Datadog rejects unknown values.',
                  enum: [0, 1, 2, 3],
                },
                interval: { type: 'integer', description: 'Aggregation interval in seconds (required for rate/count).' },
                unit: { type: 'string' },
                points: {
                  type: 'array',
                  description: 'Array of [timestampSeconds, value] pairs OR { timestamp, value } objects per v2 API.',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'integer', description: 'POSIX seconds.' },
                      value: { type: 'number' },
                    },
                    required: ['timestamp', 'value'],
                  },
                },
                resources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string', description: 'e.g. host.' },
                    },
                    required: ['name', 'type'],
                  },
                },
                tags: { type: 'array', items: { type: 'string' } },
                metadata: { type: 'object' },
              },
              required: ['metric', 'type', 'points'],
            },
          },
        },
        required: ['series'],
      },
      request: { method: 'POST', path: '/api/v2/series', body: '{series}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'metrics.submit.v1',
      class: 'mutation',
      description:
        'Submit metrics via the v1 intake (POST /api/v1/series) for clients still on the legacy payload shape (points as [[ts, value], ...]).',
      parameters: {
        type: 'object',
        properties: {
          series: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                metric: { type: 'string' },
                type: { type: 'string', enum: ['count', 'rate', 'gauge'], description: 'v1 metric type string (NOT the v2 integer).' },
                interval: { type: 'integer' },
                host: { type: 'string' },
                points: {
                  type: 'array',
                  description: 'Array of [timestampSeconds, value] tuples.',
                  items: {
                    type: 'array',
                    items: { type: 'number' },
                    minItems: 2,
                    maxItems: 2,
                  },
                },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['metric', 'points'],
            },
          },
        },
        required: ['series'],
      },
      request: { method: 'POST', path: '/api/v1/series', body: '{series}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'metrics.distribution.submit',
      class: 'mutation',
      description:
        'Submit distribution points (histogram-style metrics) to Datadog (POST /api/v1/distribution_points).',
      parameters: {
        type: 'object',
        properties: {
          series: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                metric: { type: 'string' },
                host: { type: 'string' },
                points: {
                  type: 'array',
                  description: 'Array of [timestampSeconds, [values...]] tuples.',
                },
                tags: { type: 'array', items: { type: 'string' } },
                type: { type: 'string', enum: ['distribution'] },
              },
              required: ['metric', 'points'],
            },
          },
        },
        required: ['series'],
      },
      request: { method: 'POST', path: '/api/v1/distribution_points', body: '{series}' },
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'events.post',
      class: 'mutation',
      description:
        'Post a custom event to the Datadog event stream (POST /api/v1/events). Use for deploys, incidents, agent-significant transitions.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          text: { type: 'string', description: 'Markdown-formatted body, 4000 char max.' },
          aggregation_key: { type: 'string', description: 'Use a deterministic key to dedupe in the event stream.' },
          alert_type: { type: 'string', enum: ['error', 'warning', 'info', 'success', 'user_update', 'recommendation', 'snapshot'] },
          date_happened: { type: 'integer', description: 'POSIX seconds. Defaults to now.' },
          host: { type: 'string' },
          priority: { type: 'string', enum: ['normal', 'low'] },
          related_event_id: { type: 'integer' },
          source_type_name: { type: 'string', description: 'Source integration name (e.g. github, jenkins).' },
          tags: { type: 'array', items: { type: 'string' } },
          device_name: { type: 'string' },
        },
        required: ['title', 'text'],
      },
      request: { method: 'POST', path: '/api/v1/events', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'events.list',
      class: 'read',
      description:
        'Stream events from the Datadog event stream within a time window (GET /api/v1/events). Filter by priority, sources, tags, or unaggregated mode.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'integer', description: 'POSIX seconds (required). Window start.' },
          end: { type: 'integer', description: 'POSIX seconds (required). Window end.' },
          priority: { type: 'string', enum: ['normal', 'low'] },
          sources: { type: 'string', description: 'Comma-separated list of source names to filter on.' },
          tags: { type: 'string', description: 'Comma-separated list of tags to filter on (host:foo,env:prod).' },
          unaggregated: { type: 'boolean' },
          exclude_aggregate: { type: 'boolean' },
          page: { type: 'integer', minimum: 0 },
        },
        required: ['start', 'end'],
      },
      request: {
        method: 'GET',
        path: '/api/v1/events',
        query: {
          start: '{start}',
          end: '{end}',
          priority: '{priority}',
          sources: '{sources}',
          tags: '{tags}',
          unaggregated: '{unaggregated}',
          exclude_aggregate: '{exclude_aggregate}',
          page: '{page}',
        },
      },
    },
    {
      name: 'events.get',
      class: 'read',
      description: 'Fetch a single event by ID (GET /api/v1/events/{eventId}).',
      parameters: {
        type: 'object',
        properties: { eventId: { type: 'integer' } },
        required: ['eventId'],
      },
      request: { method: 'GET', path: '/api/v1/events/{eventId}' },
    },
    {
      name: 'checks.submit',
      class: 'mutation',
      description:
        'Submit a service-check status (POST /api/v1/check_run). Use 0=OK, 1=WARNING, 2=CRITICAL, 3=UNKNOWN. Service checks back monitor types of class "service check".',
      parameters: {
        type: 'object',
        properties: {
          check: { type: 'string', description: 'Service check name (e.g. app.is_ok).' },
          host_name: { type: 'string' },
          status: { type: 'integer', enum: [0, 1, 2, 3] },
          message: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          timestamp: { type: 'integer', description: 'POSIX seconds. Defaults to now.' },
        },
        required: ['check', 'host_name', 'status'],
      },
      request: { method: 'POST', path: '/api/v1/check_run', body: 'args' },
      cas: 'none',
      externalEffect: true,
    },
  ],
})
