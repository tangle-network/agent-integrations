import { afterEach, describe, expect, it, vi } from 'vitest'
import { azureEventGridConnector } from '../src/connectors/adapters/azure-event-grid.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

const accessKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
const deliverySecret = 'delivery-secret-0123456789abcdef0123456789'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_eventgrid_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'azure-event-grid',
    label: 'Azure Event Grid test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: JSON.stringify({
        endpoint: 'https://orders.westus2-1.eventgrid.azure.net/api/events',
        accessKey,
        deliverySecret,
      }),
    },
    status: 'active',
    ...overrides,
  }
}

describe('azure-event-grid manifest', () => {
  it('ships native Event Grid and CloudEvents publishing with a valid safety manifest', () => {
    expect(azureEventGridConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'events.publish',
      'cloudEvents.publish',
    ])
    expect(validateConnectorManifest(azureEventGridConnector.manifest)).toEqual({ ok: true, issues: [] })
    for (const capability of azureEventGridConnector.manifest.capabilities) {
      expect(capability.class).toBe('mutation')
      if (capability.class !== 'mutation') throw new Error('expected mutation')
      expect(capability.cas).toBe('none')
      expect(capability.externalEffect).toBe(true)
    }
  })
})

describe('azure-event-grid publishing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('publishes an allowlisted Event Grid batch to the pinned Azure endpoint', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    let body: unknown
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>))
      body = JSON.parse(String(init?.body))
      return new Response('', { status: 200, headers: { 'x-ms-request-id': 'req-1' } })
    }))

    const result = await azureEventGridConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.publish',
      args: {
        events: [{
          id: 'evt-1',
          eventType: 'Tangle.OrderCreated',
          subject: 'orders/ord-1',
          eventTime: '2026-07-30T12:00:00-07:00',
          dataVersion: '1.0',
          data: { orderId: 'ord-1' },
          injected: 'must-not-pass',
        }],
      },
      idempotencyKey: 'publish-1',
    })

    expect(url).toBe('https://orders.westus2-1.eventgrid.azure.net/api/events?api-version=2018-01-01')
    expect(headers['aeg-sas-key']).toBe(accessKey)
    expect(headers['content-type']).toBe('application/json; charset=utf-8')
    expect(body).toEqual([{
      id: 'evt-1',
      eventType: 'Tangle.OrderCreated',
      subject: 'orders/ord-1',
      eventTime: '2026-07-30T19:00:00.000Z',
      dataVersion: '1.0',
      data: { orderId: 'ord-1' },
    }])
    expect(result).toMatchObject({
      status: 'committed',
      data: { accepted: true, count: 1, requestId: 'req-1' },
      idempotentReplay: false,
    })
  })

  it('publishes an allowlisted CloudEvents 1.0 batch', async () => {
    let body: unknown
    let contentType = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      contentType = ((init?.headers ?? {}) as Record<string, string>)['content-type']!
      return new Response('', { status: 200 })
    }))

    await azureEventGridConnector.executeMutation!({
      source: source(),
      capabilityName: 'cloudEvents.publish',
      args: {
        events: [{
          specversion: '1.0',
          id: 'evt-2',
          source: '/tangle/orders',
          type: 'tools.tangle.order.created',
          subject: 'ord-2',
          time: '2026-07-30T20:00:00Z',
          datacontenttype: 'application/json',
          data: { orderId: 'ord-2' },
          extensionNotApproved: 'drop-me',
        }],
      },
      idempotencyKey: 'publish-2',
    })

    expect(contentType).toBe('application/cloudevents-batch+json; charset=utf-8')
    expect(body).toEqual([{
      specversion: '1.0',
      id: 'evt-2',
      source: '/tangle/orders',
      type: 'tools.tangle.order.created',
      data: { orderId: 'ord-2' },
      subject: 'ord-2',
      time: '2026-07-30T20:00:00.000Z',
      datacontenttype: 'application/json',
    }])
  })

  it('rejects arbitrary endpoints and oversized batches before network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const malicious = source({
      credentials: {
        kind: 'api-key',
        apiKey: JSON.stringify({
          endpoint: 'https://169.254.169.254/api/events',
          accessKey,
          deliverySecret,
        }),
      },
    })

    await expect(azureEventGridConnector.test(malicious)).resolves.toMatchObject({ ok: false })
    await expect(azureEventGridConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.publish',
      args: {
        events: [{
          id: 'large',
          eventType: 'Large',
          subject: 'large',
          eventTime: '2026-07-30T20:00:00Z',
          dataVersion: '1',
          data: { content: 'x'.repeat(1024 * 1024) },
        }],
      },
      idempotencyKey: 'large-1',
    })).rejects.toThrow(/batch exceeds/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('azure-event-grid inbound delivery', () => {
  it('uses constant-size secret digests to authenticate the configured delivery header', () => {
    expect(azureEventGridConnector.verifySignature!({
      rawBody: '[]',
      headers: { 'X-Tangle-EventGrid-Secret': deliverySecret },
      source: source(),
    })).toEqual({ valid: true })
    expect(azureEventGridConnector.verifySignature!({
      rawBody: '[]',
      headers: { 'x-tangle-eventgrid-secret': 'wrong' },
      source: source(),
    })).toEqual({ valid: false, reason: 'Invalid x-tangle-eventgrid-secret delivery header' })
  })

  it('completes the Event Grid subscription-validation handshake without persisting an event', async () => {
    const result = await azureEventGridConnector.handleInboundEvent!({
      source: source(),
      headers: { 'x-tangle-eventgrid-secret': deliverySecret },
      rawBody: JSON.stringify([{
        id: 'validation-1',
        eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent',
        data: { validationCode: 'code-123' },
      }]),
    })

    expect(result).toEqual({
      events: [],
      response: { status: 200, body: { validationResponse: 'code-123' } },
    })
  })

  it('normalizes Event Grid and CloudEvents deliveries into the shared event contract', async () => {
    const result = await azureEventGridConnector.handleInboundEvent!({
      source: source(),
      headers: { 'x-tangle-eventgrid-secret': deliverySecret },
      rawBody: JSON.stringify([
        { id: 'native-1', eventType: 'Tangle.Native', data: { value: 1 } },
        { id: 'cloud-1', specversion: '1.0', type: 'tangle.cloud', source: '/tangle', data: { value: 2 } },
      ]),
    })

    expect(result.events).toEqual([
      {
        eventType: 'Tangle.Native',
        providerEventId: 'native-1',
        payload: { id: 'native-1', eventType: 'Tangle.Native', data: { value: 1 } },
      },
      {
        eventType: 'tangle.cloud',
        providerEventId: 'cloud-1',
        payload: { id: 'cloud-1', specversion: '1.0', type: 'tangle.cloud', source: '/tangle', data: { value: 2 } },
      },
    ])
  })
})
