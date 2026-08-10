import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonCloudWatchConnector } from '../src/connectors/adapters/amazon-cloudwatch.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_cloudwatch_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'aws-cloudwatch',
    label: 'CloudWatch test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret-key',
        region: 'eu-west-1',
      }),
    },
    status: 'active',
  }
}

function response(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/x-amz-json-1.0' },
  })
}

describe('aws-cloudwatch adapter manifest', () => {
  it('ships metrics, alarms, and dashboard operations', () => {
    expect(
      amazonCloudWatchConnector.manifest.capabilities.map((capability) => capability.name),
    ).toEqual([
      'metrics.list',
      'metrics.statistics.get',
      'metrics.data.get',
      'alarms.list',
      'dashboards.list',
      'dashboards.get',
      'metrics.publish',
      'alarms.put',
      'alarms.delete',
      'dashboards.put',
      'dashboards.delete',
    ])
  })

  it('requires approval for every write and validates safely', () => {
    const mutations = amazonCloudWatchConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(5)
    for (const mutation of mutations) expect(mutation.externalEffect).toBe(true)
    expect(validateConnectorManifest(amazonCloudWatchConnector.manifest)).toEqual({
      ok: true,
      issues: [],
    })
  })
})

describe('aws-cloudwatch execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the CloudWatch JSON protocol and monitoring SigV4 service', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ Metrics: [] })
    }))

    const result = await amazonCloudWatchConnector.executeRead!({
      source: source(),
      capabilityName: 'metrics.list',
      args: { namespace: 'AWS/Lambda', metricName: 'Errors', includeLinkedAccounts: false },
      idempotencyKey: 'metrics-1',
    })

    expect(url).toBe('https://monitoring.eu-west-1.amazonaws.com/')
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.0')
    expect(headers['X-Amz-Target']).toBe('GraniteServiceVersion20100801.ListMetrics')
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-1\/monitoring\/aws4_request,/,
    )
    expect(body).toEqual({
      Namespace: 'AWS/Lambda',
      MetricName: 'Errors',
      IncludeLinkedAccounts: false,
    })
    expect(result.data).toEqual({ Metrics: [] })
  })

  it('preserves structured custom metric data', async () => {
    let headers: Record<string, string> = {}
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response()
    }))

    const result = await amazonCloudWatchConnector.executeMutation!({
      source: source(),
      capabilityName: 'metrics.publish',
      args: {
        namespace: 'Tangle/Hub',
        metricData: [
          {
            MetricName: 'ConnectionSuccess',
            Value: 1,
            Unit: 'Count',
            Dimensions: [{ Name: 'Provider', Value: 'linkedin' }],
          },
        ],
        strictEntityValidation: true,
      },
      idempotencyKey: 'publish-1',
    })

    expect(headers['X-Amz-Target']).toBe('GraniteServiceVersion20100801.PutMetricData')
    expect(body).toEqual({
      Namespace: 'Tangle/Hub',
      MetricData: [
        {
          MetricName: 'ConnectionSuccess',
          Value: 1,
          Unit: 'Count',
          Dimensions: [{ Name: 'Provider', Value: 'linkedin' }],
        },
      ],
      StrictEntityValidation: true,
    })
    expect(result.status).toBe('committed')
  })

  it('keeps a dashboard body as its provider-required JSON string', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ DashboardValidationMessages: [] })
    }))

    await amazonCloudWatchConnector.executeMutation!({
      source: source(),
      capabilityName: 'dashboards.put',
      args: {
        dashboardName: 'Hub',
        dashboardBody: '{"widgets":[]}',
        injectedField: 'must-not-pass',
      },
      idempotencyKey: 'dashboard-1',
    })

    expect(body).toEqual({
      DashboardName: 'Hub',
      DashboardBody: '{"widgets":[]}',
    })
  })
})
