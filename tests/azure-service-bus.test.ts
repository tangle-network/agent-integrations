import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { azureServiceBusConnector } from '../src/connectors/adapters/azure-service-bus.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

const sharedKey = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')

function source(connectionString?: string): ResolvedDataSource {
  return {
    id: 'src_servicebus_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'azure-service-bus',
    label: 'Azure Service Bus test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: connectionString ?? `Endpoint=sb://acme.servicebus.windows.net/;SharedAccessKeyName=HubSend;SharedAccessKey=${sharedKey}`,
    },
    status: 'active',
  }
}

function response(body: BodyInit | null = null, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

describe('azure-service-bus manifest', () => {
  it('ships discovery, send, receive-delete, and dead-letter operations', () => {
    expect(azureServiceBusConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'queues.list',
      'queues.get',
      'topics.list',
      'topics.get',
      'subscriptions.list',
      'subscriptions.get',
      'queues.send',
      'topics.send',
      'queues.receiveDelete',
      'subscriptions.receiveDelete',
      'queues.deadLetters.receiveDelete',
      'subscriptions.deadLetters.receiveDelete',
    ])
  })

  it('passes safety validation and approval-gates every destructive or outbound operation', () => {
    expect(validateConnectorManifest(azureServiceBusConnector.manifest)).toEqual({ ok: true, issues: [] })
    const mutations = azureServiceBusConnector.manifest.capabilities.filter(
      (capability) => capability.class === 'mutation',
    )
    expect(mutations).toHaveLength(6)
    for (const mutation of mutations) {
      expect(mutation.cas, mutation.name).toBe('none')
      expect(mutation.externalEffect, mutation.name).toBe(true)
    }
  })
})

describe('azure-service-bus execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('signs the exact queue URI and sends bounded message fields', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    let requestBody = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      requestBody = Buffer.from(init?.body as Uint8Array).toString('utf8')
      return response(null, 201)
    }))

    const result = await azureServiceBusConnector.executeMutation!({
      source: source(),
      capabilityName: 'queues.send',
      args: {
        queue: 'orders',
        content: 'hello',
        encoding: 'utf-8',
        contentType: 'text/plain',
        brokerProperties: { MessageId: 'msg-1', TimeToLive: 60 },
        applicationProperties: { Tenant: 'acme', Attempts: 1 },
      },
      idempotencyKey: 'send-1',
    })

    expect(requestUrl).toBe('https://acme.servicebus.windows.net/orders/messages')
    expect(requestBody).toBe('hello')
    expect(requestHeaders['content-type']).toBe('text/plain')
    expect(JSON.parse(requestHeaders.BrokerProperties!)).toEqual({ MessageId: 'msg-1', TimeToLive: 60 })
    expect(requestHeaders.Tenant).toBe('acme')
    expect(requestHeaders.Attempts).toBe('1')
    expect(result).toMatchObject({ status: 'committed', data: { accepted: true, entityPath: 'orders', size: 5 } })

    const token = Object.fromEntries(
      requestHeaders.authorization!
        .replace(/^SharedAccessSignature /, '')
        .split('&')
        .map((part) => part.split('=').map(decodeURIComponent)),
    )
    expect(token.sr).toBe('https://acme.servicebus.windows.net/orders/messages')
    expect(token.skn).toBe('HubSend')
    const expectedSignature = createHmac('sha256', Buffer.from(sharedKey, 'base64'))
      .update(`${encodeURIComponent(token.sr!)}\n${token.se}`)
      .digest('base64')
    expect(token.sig).toBe(expectedSignature)
  })

  it('receives and permanently deletes one subscription message as bounded base64', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(
      'payload',
      200,
      {
        'content-type': 'text/plain',
        BrokerProperties: JSON.stringify({ MessageId: 'msg-1', DeliveryCount: 1 }),
        Tenant: 'acme',
      },
    )))

    const result = await azureServiceBusConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.receiveDelete',
      args: { topic: 'orders', subscription: 'workers', timeoutSeconds: 30 },
      idempotencyKey: 'receive-1',
    })

    expect(result).toMatchObject({
      status: 'committed',
      data: {
        message: {
          body: Buffer.from('payload').toString('base64'),
          encoding: 'base64',
          contentType: 'text/plain',
          brokerProperties: { MessageId: 'msg-1', DeliveryCount: 1 },
          applicationProperties: { tenant: 'acme' },
        },
      },
    })
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://acme.servicebus.windows.net/orders/subscriptions/workers/messages/head?timeout=30'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('returns an explicit null when no message is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 204)))

    const result = await azureServiceBusConnector.executeMutation!({
      source: source(),
      capabilityName: 'queues.receiveDelete',
      args: { queue: 'orders', timeoutSeconds: 0 },
      idempotencyKey: 'receive-2',
    })

    expect(result).toMatchObject({ status: 'committed', data: { message: null } })
  })

  it('parses the Atom queue feed into stable JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(`
      <feed xmlns="http://www.w3.org/2005/Atom">
        <link rel="next" href="https://acme.servicebus.windows.net/$Resources/Queues?$skip=2&amp;$top=2&amp;api-version=2017-04" />
        <entry>
          <title type="text">orders</title>
          <id>https://acme.servicebus.windows.net/orders</id>
          <updated>2026-07-30T00:00:00Z</updated>
          <content type="application/xml">
            <QueueDescription xmlns="http://schemas.microsoft.com/netservices/2010/10/servicebus/connect">
              <LockDuration>PT1M</LockDuration>
              <MaxSizeInMegabytes>1024</MaxSizeInMegabytes>
              <RequiresSession>false</RequiresSession>
              <MessageCount>3</MessageCount>
            </QueueDescription>
          </content>
        </entry>
      </feed>
    `, 200, { 'content-type': 'application/atom+xml' })))

    const result = await azureServiceBusConnector.executeRead!({
      source: source(),
      capabilityName: 'queues.list',
      args: { skip: 0, top: 2 },
      idempotencyKey: 'list-1',
    })

    expect(result.data).toEqual({
      entries: [{
        title: 'orders',
        id: 'https://acme.servicebus.windows.net/orders',
        updated: '2026-07-30T00:00:00Z',
        properties: {
          LockDuration: 'PT1M',
          MaxSizeInMegabytes: 1024,
          RequiresSession: false,
          MessageCount: 3,
        },
      }],
      nextLink: 'https://acme.servicebus.windows.net/$Resources/Queues?$skip=2&$top=2&api-version=2017-04',
    })
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://acme.servicebus.windows.net/$Resources/Queues?api-version=2017-04&%24skip=0&%24top=2'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('enforces EntityPath before issuing a request, including queue dead letters', async () => {
    const fetchMock = vi.fn(async () => response(null, 204))
    vi.stubGlobal('fetch', fetchMock)
    const scoped = source(`Endpoint=sb://acme.servicebus.windows.net/;SharedAccessKeyName=QueueListen;SharedAccessKey=${sharedKey};EntityPath=orders`)

    await expect(azureServiceBusConnector.executeMutation!({
      source: scoped,
      capabilityName: 'queues.receiveDelete',
      args: { queue: 'payments' },
      idempotencyKey: 'scope-1',
    })).rejects.toThrow(/restricts access to orders/)
    expect(fetchMock).not.toHaveBeenCalled()

    await azureServiceBusConnector.executeMutation!({
      source: scoped,
      capabilityName: 'queues.deadLetters.receiveDelete',
      args: { queue: 'orders' },
      idempotencyKey: 'scope-2',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects arbitrary endpoints and path injection before network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(azureServiceBusConnector.test(source(
      `Endpoint=sb://169.254.169.254/;SharedAccessKeyName=Root;SharedAccessKey=${sharedKey}`,
    ))).resolves.toEqual({
      ok: false,
      reason: 'Azure Service Bus Endpoint must be a public Azure Service Bus namespace',
    })
    await expect(azureServiceBusConnector.executeMutation!({
      source: source(),
      capabilityName: 'queues.send',
      args: { queue: '../admin', content: 'hello' },
      idempotencyKey: 'inject-1',
    })).rejects.toThrow(/valid Azure Service Bus entity name/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
