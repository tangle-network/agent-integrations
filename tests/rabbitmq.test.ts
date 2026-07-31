import type { Channel, ChannelModel, ConfirmChannel, Message, Options, SocketOptions } from 'amqplib'
import { describe, expect, it } from 'vitest'
import { createRabbitMqConnector, rabbitMqConnector } from '../src/connectors/adapters/rabbitmq.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('RabbitMQ connector', () => {
  it('ships executable setup and approval-gates every publish action', () => {
    expect(validateConnectorManifest(rabbitMqConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(rabbitMqConnector.manifest.capabilities.filter((capability) => capability.class === 'mutation')).toMatchObject([
      { name: 'send.message.to.queue', externalEffect: true },
      { name: 'send.message.to.exchange', externalEffect: true },
    ])
    expect(getIntegrationSpec('rabbitmq')).toMatchObject({
      status: 'executable',
      setup: { credentialFields: [{ label: 'RabbitMQ connection JSON', secret: true }] },
    })
  })

  it('publishes JSON to an existing queue with mandatory broker confirmation', async () => {
    let checkedQueue: string | undefined
    let published: { queue: string; body: Buffer; options?: Options.Publish } | undefined
    let confirms = 0
    const channel = fakeConfirmChannel({
      checkQueue: async (queue) => {
        checkedQueue = queue
        return { queue, messageCount: 0, consumerCount: 1 }
      },
      sendToQueue: (queue, body, options) => {
        published = { queue, body, options }
        return true
      },
      waitForConfirms: async () => { confirms += 1 },
    })
    const connector = connectorWith(channel)
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'send.message.to.queue',
      args: { queue: 'jobs', data: { dealId: 'deal_1' } },
      idempotencyKey: 'publish-queue-1',
    })
    expect(checkedQueue).toBe('jobs')
    expect(published).toMatchObject({
      queue: 'jobs',
      options: { mandatory: true, persistent: true, contentType: 'application/json' },
    })
    expect(JSON.parse(published!.body.toString())).toEqual({ dealId: 'deal_1' })
    expect(published!.options?.messageId).toMatch(/^[a-f0-9]{64}$/)
    expect(confirms).toBe(1)
    expect(result).toMatchObject({ status: 'committed', data: { queue: 'jobs', confirmed: true } })
  })

  it('publishes to an existing exchange with routing, expiration, and priority', async () => {
    let checkedExchange: string | undefined
    let published: { exchange: string; routingKey: string; options?: Options.Publish } | undefined
    const channel = fakeConfirmChannel({
      checkExchange: async (exchange) => { checkedExchange = exchange; return {} },
      publish: (exchange, routingKey, _body, options) => {
        published = { exchange, routingKey, options }
        return true
      },
    })
    const connector = connectorWith(channel)
    await connector.executeMutation!({
      source: source(),
      capabilityName: 'send.message.to.exchange',
      args: { exchange: 'events', routingKey: 'deal.approved', data: ['ok'], expirationMs: 5_000, priority: 3 },
      idempotencyKey: 'publish-exchange-1',
    })
    expect(checkedExchange).toBe('events')
    expect(published).toMatchObject({
      exchange: 'events',
      routingKey: 'deal.approved',
      options: { expiration: '5000', priority: 3, mandatory: true },
    })
  })

  it('returns queue depth and consumer count from a real channel contract', async () => {
    const regular = fakeChannel({
      checkQueue: async (queue) => ({ queue, messageCount: 41, consumerCount: 2 }),
    })
    const connector = createRabbitMqConnector({
      resolveHost: async () => ['203.0.113.10'],
      // The fake replaces only the RabbitMQ TCP/TLS process boundary.
      connect: async () => fakeModel(undefined, regular),
    })
    const result = await connector.executeRead!({
      source: source(),
      capabilityName: 'rabbitmq.queues.inspect',
      args: { queue: 'jobs' },
      idempotencyKey: 'inspect-1',
    })
    expect(result.data).toEqual({ queue: 'jobs', messageCount: 41, consumerCount: 2 })
  })

  it('pins AMQPS, certificate validation, public DNS lookup, and TLS 1.2 before connecting', async () => {
    let connectOptions: Options.Connect | undefined
    let socketOptions: SocketOptions | undefined
    const connector = createRabbitMqConnector({
      resolveHost: async () => ['203.0.113.10'],
      connect: async (nextConnect, nextSocket) => {
        connectOptions = nextConnect
        socketOptions = nextSocket
        return fakeModel(fakeConfirmChannel())
      },
    })
    await connector.test(source())
    expect(connectOptions).toMatchObject({ protocol: 'amqps', hostname: 'broker.example.com', port: 5671, vhost: '/tenant' })
    expect(socketOptions).toMatchObject({ minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: 'broker.example.com' })
    expect(socketOptions?.lookup).toBeTypeOf('function')
  })

  it('rejects private literal and private DNS targets before opening a socket', async () => {
    let connections = 0
    const privateLiteral = createRabbitMqConnector({ connect: async () => { connections += 1; return fakeModel() } })
    const literalResult = await privateLiteral.test(source({ host: '127.0.0.1' }))
    expect(literalResult).toMatchObject({ ok: false })

    const privateDns = createRabbitMqConnector({
      resolveHost: async () => { throw new Error('host is not a public network target') },
      connect: async () => { connections += 1; return fakeModel() },
    })
    const dnsResult = await privateDns.test(source())
    expect(dnsResult).toEqual({ ok: false, reason: 'host is not a public network target' })
    expect(connections).toBe(0)
  })

  it('redacts the password from connection failures', async () => {
    const connector = createRabbitMqConnector({
      resolveHost: async () => ['203.0.113.10'],
      connect: async () => { throw new Error('auth failed for correct-horse-battery-staple') },
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'rabbitmq.queues.inspect',
      args: { queue: 'jobs' },
      idempotencyKey: 'redact-1',
    })).rejects.toThrow('auth failed for [REDACTED]')
  })

  it('rejects mandatory messages that the broker returns as unroutable', async () => {
    let channel: ConfirmChannel
    channel = fakeConfirmChannel({
      sendToQueue: () => {
        channel.emit('return', {} as Message)
        return true
      },
    })
    const connector = connectorWith(channel)
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'send.message.to.queue',
      args: { queue: 'jobs', data: { dealId: 'deal_1' } },
      idempotencyKey: 'unroutable-1',
    })).rejects.toThrow('RabbitMQ accepted but could not route the message')
  })

  it('reports unknown mutations before validating mutation arguments', async () => {
    const connector = connectorWith(fakeConfirmChannel())
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'rabbitmq.unknown',
      args: {},
      idempotencyKey: 'unknown-1',
    })).rejects.toThrow('Unknown RabbitMQ mutation capability: rabbitmq.unknown')
  })

  it('accepts public IPv6 literals without treating colons as a port separator', async () => {
    let connectOptions: Options.Connect | undefined
    const connector = createRabbitMqConnector({
      resolveHost: async (host) => [host],
      connect: async (nextConnect) => {
        connectOptions = nextConnect
        return fakeModel()
      },
    })
    const result = await connector.test(source({ host: '2001:4860:4860::8888' }))
    expect(result).toEqual({ ok: true })
    expect(connectOptions).toMatchObject({ protocol: 'amqps', hostname: '2001:4860:4860::8888' })
  })

  it('rejects malformed credential JSON without leaking it', async () => {
    const connector = createRabbitMqConnector()
    const malformed = source()
    malformed.credentials = { kind: 'api-key', apiKey: '{not-json' }
    await expect(connector.executeRead!({
      source: malformed,
      capabilityName: 'rabbitmq.queues.inspect',
      args: { queue: 'jobs' },
      idempotencyKey: 'malformed-1',
    })).rejects.toThrow('RabbitMQ credential must be valid JSON')
  })

  it('closes the channel and connection when a broker resource check fails', async () => {
    let channelCloses = 0
    let modelCloses = 0
    const channel = fakeChannel({
      checkQueue: async () => { throw new Error('queue jobs does not exist') },
      close: async () => { channelCloses += 1 },
    })
    const connector = createRabbitMqConnector({
      resolveHost: async () => ['203.0.113.10'],
      connect: async () => ({
        ...fakeModel(undefined, channel),
        close: async () => { modelCloses += 1 },
      } as ChannelModel),
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'rabbitmq.queues.inspect',
      args: { queue: 'jobs' },
      idempotencyKey: 'missing-queue-1',
    })).rejects.toThrow('queue jobs does not exist')
    expect({ channelCloses, modelCloses }).toEqual({ channelCloses: 1, modelCloses: 1 })
  })

  it('bounds custom CA bundles before DNS or broker access', async () => {
    let resolved = false
    const connector = createRabbitMqConnector({
      resolveHost: async () => { resolved = true; return ['203.0.113.10'] },
    })
    const result = await connector.test(source({ tlsCa: Array.from({ length: 17 }, () => 'certificate') }))
    expect(result).toMatchObject({ ok: false })
    expect(resolved).toBe(false)
  })

  it('rejects oversized messages before DNS or broker access', async () => {
    let resolved = false
    const connector = createRabbitMqConnector({
      resolveHost: async () => { resolved = true; return ['203.0.113.10'] },
      connect: async () => fakeModel(fakeConfirmChannel()),
    })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'send.message.to.queue',
      args: { queue: 'jobs', data: 'x'.repeat(1024 * 1024 + 1) },
      idempotencyKey: 'large-1',
    })).rejects.toThrow(/1048576-byte limit/)
    expect(resolved).toBe(false)
  })
})

function connectorWith(channel: ConfirmChannel) {
  return createRabbitMqConnector({
    resolveHost: async () => ['203.0.113.10'],
    // The fake replaces only the RabbitMQ TCP/TLS process boundary.
    connect: async () => fakeModel(channel),
  })
}

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'src_rabbitmq_1',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'rabbitmq',
    label: 'RabbitMQ test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'broker.example.com',
        username: 'tangle',
        password: 'correct-horse-battery-staple',
        vhost: '/tenant',
        ...overrides,
      },
    },
    status: 'active',
  }
}

function fakeModel(confirm?: ConfirmChannel, regular?: Channel): ChannelModel {
  return {
    createConfirmChannel: async () => confirm ?? fakeConfirmChannel(),
    createChannel: async () => regular ?? fakeChannel(),
    close: async () => undefined,
  } as unknown as ChannelModel
}

function fakeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    checkQueue: async (queue: string) => ({ queue, messageCount: 0, consumerCount: 0 }),
    checkExchange: async () => ({}),
    close: async () => undefined,
    ...overrides,
  } as unknown as Channel
}

function fakeConfirmChannel(overrides: Partial<ConfirmChannel> = {}): ConfirmChannel {
  const listeners = new Map<string, Array<(message: Message) => void>>()
  return {
    checkQueue: async (queue: string) => ({ queue, messageCount: 0, consumerCount: 0 }),
    checkExchange: async () => ({}),
    sendToQueue: () => true,
    publish: () => true,
    waitForConfirms: async () => undefined,
    close: async () => undefined,
    on(event: string, listener: (message: Message) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return this
    },
    removeListener(event: string, listener: (message: Message) => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter((candidate) => candidate !== listener))
      return this
    },
    emit(event: string, message: Message) {
      for (const listener of listeners.get(event) ?? []) listener(message)
      return (listeners.get(event)?.length ?? 0) > 0
    },
    ...overrides,
  } as unknown as ConfirmChannel
}
