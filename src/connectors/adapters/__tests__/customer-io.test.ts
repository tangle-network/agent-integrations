import { afterEach, describe, expect, it, vi } from 'vitest'
import { customerIoConnector } from '../customer-io.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_customer_io',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'customer-io',
  label: 'customer-io',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'app_api_key_test' },
  status: 'active',
}

const euSource: ResolvedDataSource = {
  ...source,
  id: 'source_customer_io_eu',
  metadata: { baseUrl: 'https://api-eu.customer.io' },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('customer-io adapter', () => {
  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(customerIoConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares api-key auth and the runtime "other" category (catalog "workflow" maps to "other" in the manifest enum)', () => {
    expect(customerIoConnector.manifest.kind).toBe('customer-io')
    expect(customerIoConnector.manifest.displayName).toBe('Customer.io')
    expect(customerIoConnector.manifest.category).toBe('other')
    expect(customerIoConnector.manifest.auth.kind).toBe('api-key')
  })

  it('publishes the App API capability surface (customers + segments + campaigns + messages + transactional)', () => {
    const names = customerIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'campaigns.get',
      'campaigns.search',
      'campaigns.trigger',
      'customers.get',
      'customers.search',
      'customers.segments',
      'messages.search',
      'segments.add-customers',
      'segments.get',
      'segments.remove-customers',
      'segments.search',
      'transactional.send-email',
    ])

    const readers = customerIoConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = customerIoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual([
      'campaigns.get',
      'campaigns.search',
      'customers.get',
      'customers.search',
      'customers.segments',
      'messages.search',
      'segments.get',
      'segments.search',
    ])
    expect(mutators).toEqual([
      'campaigns.trigger',
      'segments.add-customers',
      'segments.remove-customers',
      'transactional.send-email',
    ])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof customerIoConnector.executeRead).toBe('function')
    expect(typeof customerIoConnector.executeMutation).toBe('function')
  })

  it('triggers a campaign via POST /v1/campaigns/{id}/triggers with Bearer auth and merged trigger body', async () => {
    const fetchMock = mockFetch({ id: 'trigger_1' }, { status: 200 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'campaigns.trigger',
      args: {
        campaignId: 42,
        ids: ['cust_1', 'cust_2'],
        data: { promo_code: 'SPRING25' },
      },
      idempotencyKey: 'trigger_1',
    }

    const result = await customerIoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.customer.io/v1/campaigns/42/triggers')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer app_api_key_test',
      'content-type': 'application/json',
    })
    const body = JSON.parse(String(init.body))
    expect(body.ids).toEqual(['cust_1', 'cust_2'])
    expect(body.data).toEqual({ promo_code: 'SPRING25' })
    // campaignId is also consumed by the path interpolator (/v1/campaigns/{campaignId}/triggers);
    // Customer.io ignores unknown keys so leaving it in the body is harmless.
    expect(body.campaignId).toBe(42)
  })

  it('sends a transactional email via POST /v1/send/email with the message payload', async () => {
    const fetchMock = mockFetch({ delivery_id: 'd_1' }, { status: 200 })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'transactional.send-email',
      args: {
        message: {
          transactional_message_id: 7,
          to: 'ada@example.com',
          identifiers: { id: 'cust_1' },
          message_data: { order_number: 'A123' },
        },
      },
      idempotencyKey: 'tx_1',
    }

    const result = await customerIoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.customer.io/v1/send/email')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.transactional_message_id).toBe(7)
    expect(body.to).toBe('ada@example.com')
    expect(body.identifiers).toEqual({ id: 'cust_1' })
    expect(body.message_data).toEqual({ order_number: 'A123' })
  })

  it('reads a customer profile via GET /v1/customers/{id}/attributes', async () => {
    const fetchMock = mockFetch({ customer: { id: 'cust_1', attributes: {} } })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'customers.get',
      args: { customerId: 'cust_1' },
      idempotencyKey: 'cust_get_1',
    }

    await customerIoConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://api.customer.io/v1/customers/cust_1/attributes')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ authorization: 'Bearer app_api_key_test' })
  })

  it('paginates messages.search via /v1/messages with start/limit query params', async () => {
    const fetchMock = mockFetch({ messages: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'messages.search',
      args: { limit: 100, type: 'email', metric: 'delivered' },
      idempotencyKey: 'msg_1',
    }

    await customerIoConnector.executeRead!(invocation)

    const [url] = fetchMock.mock.calls[0]! as unknown as [URL]
    expect(url.pathname).toBe('/v1/messages')
    expect(url.searchParams.get('limit')).toBe('100')
    expect(url.searchParams.get('type')).toBe('email')
    expect(url.searchParams.get('metric')).toBe('delivered')
    expect(url.searchParams.has('start')).toBe(false)
  })

  it('honours per-connection EU base URL via metadata.baseUrl', async () => {
    const fetchMock = mockFetch({ segments: [] })
    const invocation: ConnectorInvocation = {
      source: euSource,
      capabilityName: 'segments.search',
      args: {},
      idempotencyKey: 'eu_segs_1',
    }

    await customerIoConnector.executeRead!(invocation)

    const [url] = fetchMock.mock.calls[0]! as unknown as [URL]
    expect(String(url)).toBe('https://api-eu.customer.io/v1/segments')
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
