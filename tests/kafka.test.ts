import type { Admin, Consumer, KafkaConfig, Producer } from 'kafkajs'
import { describe, expect, it } from 'vitest'
import {
  createKafkaConnector,
  kafkaConnector,
  publicKafkaSocketFactory,
  type KafkaConnectorOptions,
} from '../src/connectors/adapters/kafka.js'
import { validateConnectorManifest, type ConnectorCredentials, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('Kafka connector', () => {
  it('passes the shared manifest validator and approval-gates every stateful operation', () => {
    expect(validateConnectorManifest(kafkaConnector.manifest)).toEqual({ ok: true, issues: [] })
    const mutations = kafkaConnector.manifest.capabilities.filter((capability) => capability.class === 'mutation')
    expect(mutations.map((capability) => capability.name)).toEqual([
      'kafka.messages.produce',
      'kafka.messages.consume',
      'kafka.offsets.commit',
      'kafka.topics.create',
      'kafka.topics.delete',
    ])
    expect(mutations.every((capability) => capability.externalEffect)).toBe(true)
  })

  it('exposes executable setup with a structured encrypted credential', () => {
    const spec = getIntegrationSpec('kafka')
    expect(spec?.status).toBe('executable')
    expect(spec?.auth).toMatchObject({ mode: 'api_key', placement: undefined })
    expect(spec?.setup.credentialFields).toMatchObject([{ label: 'Kafka connection JSON', secret: true }])
    expect(spec?.setup.knownQuirks?.map((quirk) => quirk.id)).toEqual([
      'tls-only',
      'public-brokers',
      'consumer-rebalance',
      'explicit-commit',
    ])
  })

  it('connects and disconnects around topic discovery', async () => {
    const calls: string[] = []
    const admin = fakeAdmin({
      connect: async () => { calls.push('connect') },
      listTopics: async () => ['events', 'audit'],
      disconnect: async () => { calls.push('disconnect') },
    })
    const connector = createKafkaConnector({ createClient: () => fakeClient({ admin }) })
    const result = await connector.executeRead!({
      source: source(),
      capabilityName: 'kafka.topics.list',
      args: {},
      idempotencyKey: 'kafka-list-1',
    })
    expect(result.data).toEqual({ topics: ['events', 'audit'] })
    expect(calls).toEqual(['connect', 'disconnect'])
  })

  it('produces acknowledged binary records with an idempotent producer', async () => {
    let producerConfig: unknown
    let sent: unknown
    const producer = fakeProducer({
      send: async (record) => {
        sent = record
        return [{ topicName: record.topic, partition: 0, errorCode: 0, baseOffset: '41' }]
      },
    })
    const connector = createKafkaConnector({
      createClient: () => fakeClient({
        producer,
        onProducerConfig: (config) => { producerConfig = config },
      }),
    })
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'kafka.messages.produce',
      args: {
        topic: 'events',
        messages: [{ key: 'deal-1', value: 'approved', headers: { source: 'tangle' } }],
      },
      idempotencyKey: 'kafka-produce-1',
    })
    expect(result.status).toBe('committed')
    expect(producerConfig).toEqual({ idempotent: true, maxInFlightRequests: 1 })
    expect(sent).toMatchObject({
      topic: 'events',
      acks: -1,
      messages: [{ key: Buffer.from('deal-1'), value: Buffer.from('approved'), headers: { source: 'tangle' } }],
    })
  })

  it('returns a bounded consumer batch without committing offsets', async () => {
    let committed = false
    const consumer = fakeConsumer({
      run: async (config) => {
        if (!config?.eachMessage) throw new Error('missing eachMessage handler')
        await config.eachMessage({
          topic: 'events',
          partition: 2,
          message: {
            key: Buffer.from('deal-1'),
            value: Buffer.from('approved'),
            timestamp: '1000',
            attributes: 0,
            offset: '41',
            headers: { source: Buffer.from('tangle') },
          },
          heartbeat: async () => undefined,
          pause: () => () => undefined,
        })
      },
      commitOffsets: async () => { committed = true },
    })
    const connector = createKafkaConnector({ createClient: () => fakeClient({ consumer }) })
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'kafka.messages.consume',
      args: { topic: 'events', groupId: 'tangle-workflow', limit: 1, timeoutMs: 250 },
      idempotencyKey: 'kafka-consume-1',
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('Kafka consume was not committed')
    expect(result.data).toEqual({
      topic: 'events',
      messages: [{
        topic: 'events',
        partition: 2,
        offset: '41',
        timestamp: '1000',
        key: 'deal-1',
        value: 'approved',
        headers: { source: 'tangle' },
      }],
      messageCount: 1,
      offsetsCommitted: false,
    })
    expect(committed).toBe(false)
  })

  it('rejects private broker addresses before constructing a client or socket', async () => {
    let clientsCreated = 0
    const connector = createKafkaConnector({
      createClient: () => { clientsCreated += 1; return fakeClient({}) },
    })
    await expect(connector.executeRead!({
      source: source({ brokers: ['127.0.0.1:9093'] }),
      capabilityName: 'kafka.topics.list',
      args: {},
      idempotencyKey: 'kafka-private-1',
    })).rejects.toThrow(/not a public network target/)
    expect(clientsCreated).toBe(0)
    expect(() => publicKafkaSocketFactory({
      host: '10.0.0.1',
      port: 9093,
      ssl: {},
      onConnect: () => undefined,
    })).toThrow(/not a public network target/)
  })

  it('rejects an oversized produce batch before connecting to Kafka', async () => {
    let connected = false
    const producer = fakeProducer({ connect: async () => { connected = true } })
    const connector = createKafkaConnector({ createClient: () => fakeClient({ producer }) })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'kafka.messages.produce',
      args: {
        topic: 'events',
        messages: Array.from({ length: 11 }, () => ({ value: 'x'.repeat(1024 * 1024) })),
      },
      idempotencyKey: 'kafka-oversized-1',
    })).rejects.toThrow(/batch limit/)
    expect(connected).toBe(false)
  })

  it('always builds TLS 1.2+, certificate-verifying client configuration', async () => {
    let config: KafkaConfig | undefined
    const connector = createKafkaConnector({
      createClient: (value) => { config = value; return fakeClient({ admin: fakeAdmin() }) },
    })
    await connector.executeRead!({
      source: source(),
      capabilityName: 'kafka.topics.list',
      args: {},
      idempotencyKey: 'kafka-config-1',
    })
    expect(config).toMatchObject({
      brokers: ['broker.example.com:9093'],
      ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      sasl: { mechanism: 'scram-sha-512', username: 'integration', password: 'secret' },
      enforceRequestTimeout: true,
    })
    expect(config?.socketFactory).toBe(publicKafkaSocketFactory)
  })
})

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  const credentials: ConnectorCredentials = {
    kind: 'custom',
    values: {
      brokers: ['broker.example.com:9093'],
      saslMechanism: 'scram-sha-512',
      saslUsername: 'integration',
      saslPassword: 'secret',
      ...overrides,
    },
  }
  return {
    id: 'kafka-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'kafka',
    label: 'Kafka',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials,
    status: 'active',
  }
}

type TestKafkaClient = ReturnType<NonNullable<KafkaConnectorOptions['createClient']>>

function fakeClient(options: {
  admin?: Admin
  producer?: Producer
  consumer?: Consumer
  onProducerConfig?: (config: unknown) => void
}): TestKafkaClient {
  return {
    admin: () => options.admin ?? fakeAdmin(),
    producer: (config) => {
      options.onProducerConfig?.(config)
      return options.producer ?? fakeProducer()
    },
    consumer: () => options.consumer ?? fakeConsumer(),
  }
}

function fakeAdmin(overrides: Partial<Admin> = {}): Admin {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    listTopics: async () => [],
    ...overrides,
  } as Admin
}

function fakeProducer(overrides: Partial<Producer> = {}): Producer {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    send: async () => [],
    ...overrides,
  } as Producer
}

function fakeConsumer(overrides: Partial<Consumer> = {}): Consumer {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    subscribe: async () => undefined,
    stop: async () => undefined,
    run: async () => undefined,
    commitOffsets: async () => undefined,
    ...overrides,
  } as Consumer
}
