import { afterEach, describe, expect, it, vi } from 'vitest'
import { amazonEventBridgeConnector } from '../src/connectors/adapters/amazon-eventbridge.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_eventbridge_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'amazon-eventbridge',
    label: 'EventBridge test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'secret-key',
        region: 'us-west-2',
      }),
    },
    status: 'active',
  }
}

function response(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('amazon-eventbridge adapter manifest', () => {
  it('ships the expected event, bus, rule, and target operations', () => {
    expect(amazonEventBridgeConnector.manifest.kind).toBe('amazon-eventbridge')
    expect(amazonEventBridgeConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'events.publish',
      'event-buses.list',
      'event-buses.create',
      'event-buses.delete',
      'rules.list',
      'rules.get',
      'rules.put',
      'rules.delete',
      'targets.list',
      'targets.put',
      'targets.remove',
    ])
  })

  it('requires approval and makes no replay guarantee for every write', () => {
    const mutations = amazonEventBridgeConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(7)
    for (const mutation of mutations) {
      expect(mutation.externalEffect, mutation.name).toBe(true)
      expect(mutation.cas, mutation.name).toBe('none')
    }
  })
})

describe('amazon-eventbridge execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs PutEvents for the events service and preserves structured entries', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] })
    }))

    const result = await amazonEventBridgeConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.publish',
      args: {
        entries: [{
          Source: 'tangle.orders',
          DetailType: 'OrderCreated',
          Detail: '{"orderId":"ord_1"}',
          EventBusName: 'orders',
        }],
      },
      idempotencyKey: 'publish-1',
    })

    expect(url).toBe('https://events.us-west-2.amazonaws.com/')
    expect(headers['X-Amz-Target']).toBe('AWSEvents.PutEvents')
    expect(headers['Content-Type']).toBe('application/x-amz-json-1.1')
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/us-west-2\/events\/aws4_request,/,
    )
    expect(body).toEqual({
      Entries: [{
        Source: 'tangle.orders',
        DetailType: 'OrderCreated',
        Detail: '{"orderId":"ord_1"}',
        EventBusName: 'orders',
      }],
    })
    expect(result.status).toBe('committed')
  })

  it('maps only declared PutRule fields and drops undeclared arguments', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ RuleArn: 'arn:aws:events:us-west-2:123456789012:rule/orders/new' })
    }))

    await amazonEventBridgeConnector.executeMutation!({
      source: source(),
      capabilityName: 'rules.put',
      args: {
        name: 'new-order',
        eventBusName: 'orders',
        state: 'ENABLED',
        injectedField: 'must-not-pass',
      },
      idempotencyKey: 'rule-1',
    })

    expect(body).toEqual({
      Name: 'new-order',
      EventBusName: 'orders',
      State: 'ENABLED',
    })
  })

  it('maps target removal arrays and booleans without stringifying them', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return response({ FailedEntryCount: 0, FailedEntries: [] })
    }))

    await amazonEventBridgeConnector.executeMutation!({
      source: source(),
      capabilityName: 'targets.remove',
      args: { rule: 'new-order', eventBusName: 'orders', ids: ['worker'], force: false },
      idempotencyKey: 'targets-1',
    })

    expect(body).toEqual({
      Rule: 'new-order',
      EventBusName: 'orders',
      Ids: ['worker'],
      Force: false,
    })
  })
})
