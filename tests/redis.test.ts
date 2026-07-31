import type { RedisClientOptions } from 'redis'
import { describe, expect, it, vi } from 'vitest'
import { CONNECTOR_ADAPTER_FACTORIES } from '../src/connectors/adapters/factories.js'
import {
  createRedisConnector,
  redisConnector,
  type RedisConnectorOptions,
} from '../src/connectors/adapters/redis.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'
import { getIntegrationSpec } from '../src/specs/index.js'

describe('Redis connector', () => {
  it('ships a valid authoritative manifest with approval-gated compare-and-swap writes', () => {
    expect(validateConnectorManifest(redisConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(redisConnector.manifest.capabilities.map((capability) => capability.name)).toEqual([
      'redis.keys.scan',
      'redis.key.inspect',
      'redis.string.get',
      'redis.string.set',
      'redis.string.delete',
    ])
    expect(redisConnector.manifest.capabilities.filter((capability) => capability.class === 'mutation')).toMatchObject([
      { cas: 'optimistic-read-verify', externalEffect: true },
      { cas: 'optimistic-read-verify', externalEffect: true },
    ])
  })

  it('exposes executable structured-secret setup and a no-shared-secret factory', () => {
    expect(getIntegrationSpec('redis')).toMatchObject({
      status: 'executable',
      setup: { credentialFields: [{ label: 'Redis connection JSON', secret: true }] },
    })
    const factory = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === 'redis')
    expect(factory?.envMap).toEqual({})
    expect(factory?.factory({}).manifest.kind).toBe('redis')
  })

  it('pins a public address while retaining the DNS name for verified TLS identity', async () => {
    let config: RedisClientOptions | undefined
    const connector = createRedisConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: (nextConfig) => {
        config = nextConfig
        return fakeClient()
      },
    })
    await expect(connector.test(source())).resolves.toEqual({ ok: true })
    expect(config).toMatchObject({
      username: 'integration',
      database: 2,
      disableOfflineQueue: true,
      maintNotifications: 'disabled',
      socket: {
        host: '203.0.113.10',
        port: 6380,
        tls: true,
        servername: 'cache.example.com',
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
        reconnectStrategy: false,
      },
    })
  })

  it('uses bounded SCAN instead of a blocking key enumeration', async () => {
    const evalCommand = vi.fn(async () => ['17', ['deal:1', 'deal:2']])
    const connector = connectorWith(fakeClient({ eval: evalCommand }))
    const result = await connector.executeRead!({
      source: source(),
      capabilityName: 'redis.keys.scan',
      args: { cursor: '0', match: 'deal:*', count: 25, type: 'hash' },
      idempotencyKey: 'redis-scan-1',
    })
    expect(evalCommand).toHaveBeenCalledWith(expect.stringContaining("redis.call('SCAN'"), {
      keys: [],
      arguments: ['0', 'deal:*', '25', 'hash', '1000', '1048576', '1024'],
    })
    expect(result.data).toEqual({ cursor: '17', keys: ['deal:1', 'deal:2'] })
  })

  it('reads a bounded string and expiry through one atomic server script', async () => {
    const evalCommand = vi.fn(async () => ['string', 9_000, 'signed', 6])
    const connector = connectorWith(fakeClient({ eval: evalCommand }))
    const result = await connector.executeRead!({
      source: source(),
      capabilityName: 'redis.string.get',
      args: { key: 'deal:42:stage' },
      idempotencyKey: 'redis-get-1',
    })
    expect(evalCommand).toHaveBeenCalledOnce()
    expect(result.data).toEqual({
      key: 'deal:42:stage',
      exists: true,
      type: 'string',
      ttlMs: 9_000,
      value: 'signed',
      byteLength: 6,
    })
  })

  it('commits an approved atomic set only when the presence condition matches', async () => {
    const set = vi.fn(async () => 'OK')
    const connector = connectorWith(fakeClient({ set }))
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.set',
      args: { key: 'lock:deal:42', value: 'owner-1', condition: 'absent', ttlMs: 30_000 },
      idempotencyKey: 'redis-set-1',
    })
    expect(set).toHaveBeenCalledWith('lock:deal:42', 'owner-1', {
      condition: 'NX',
      expiration: { type: 'PX', value: 30_000 },
    })
    expect(result).toMatchObject({ status: 'committed', data: { condition: 'absent' } })
  })

  it('returns a conflict when Redis rejects a conditional set', async () => {
    const connector = connectorWith(fakeClient({ set: async () => null }))
    const result = await connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.set',
      args: { key: 'lock:deal:42', value: 'owner-2', condition: 'absent' },
      idempotencyKey: 'redis-set-conflict',
    })
    expect(result).toMatchObject({ status: 'conflict' })
  })

  it('uses atomic compare-and-set and compare-and-delete scripts for value conditions', async () => {
    const evalCommand = vi.fn(async () => 1)
    const connector = connectorWith(fakeClient({ eval: evalCommand }))
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.set',
      args: { key: 'deal:42:stage', value: 'won', condition: 'matches', expectedValue: 'contract', keepTtl: true },
      idempotencyKey: 'redis-cas-1',
    })).resolves.toMatchObject({ status: 'committed' })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.delete',
      args: { key: 'deal:42:stage', expectedValue: 'won' },
      idempotencyKey: 'redis-delete-1',
    })).resolves.toMatchObject({ status: 'committed', data: { deleted: true } })
    expect(evalCommand).toHaveBeenCalledTimes(2)
  })

  it('rejects private targets and oversized writes before creating a client', async () => {
    const createClient = vi.fn(() => fakeClient())
    const connector = createRedisConnector({ createClient })
    await expect(connector.test(source({ host: '127.0.0.1' }))).resolves.toMatchObject({ ok: false })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.set',
      args: { key: 'large', value: 'x'.repeat(1024 * 1024 + 1), condition: 'absent' },
      idempotencyKey: 'redis-large-1',
    })).rejects.toThrow(/1048576-byte limit/)
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects private DNS answers and malformed conditional writes before creating a client', async () => {
    const createClient = vi.fn(() => fakeClient())
    const privateDns = createRedisConnector({
      resolveHost: async () => { throw new Error('host is not a public network target') },
      createClient,
    })
    await expect(privateDns.test(source())).resolves.toEqual({ ok: false, reason: 'host is not a public network target' })

    const connector = createRedisConnector({ createClient })
    await expect(connector.executeMutation!({
      source: source(),
      capabilityName: 'redis.string.set',
      args: { key: 'deal:42', value: 'won', condition: 'matches' },
      idempotencyKey: 'redis-missing-expected',
    })).rejects.toThrow('expectedValue is required')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('rejects oversized or malformed SCAN replies from the provider', async () => {
    const connector = connectorWith(fakeClient({
      eval: async () => ['not-a-cursor', Array.from({ length: 1_001 }, (_, index) => `key:${index}`)],
    }))
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redis.keys.scan',
      args: { count: 100 },
      idempotencyKey: 'redis-large-scan',
    })).rejects.toThrow('Redis SCAN page exceeds 1000 keys')
  })

  it('redacts passwords from connection failures and rejects malformed credential JSON', async () => {
    const connector = createRedisConnector({
      resolveHost: async () => ['203.0.113.10'],
      createClient: () => fakeClient({ connect: async () => { throw new Error('auth failed for not-a-real-secret') } }),
    })
    await expect(connector.executeRead!({
      source: source(),
      capabilityName: 'redis.key.inspect',
      args: { key: 'deal:42' },
      idempotencyKey: 'redis-redact-1',
    })).rejects.toThrow('auth failed for [REDACTED]')

    const malformed = source()
    malformed.credentials = { kind: 'api-key', apiKey: '{bad-json' }
    await expect(connector.executeRead!({
      source: malformed,
      capabilityName: 'redis.key.inspect',
      args: { key: 'deal:42' },
      idempotencyKey: 'redis-malformed-1',
    })).rejects.toThrow('Redis credential must be valid JSON')
  })
})

type RedisClientLikeForTest = ReturnType<NonNullable<RedisConnectorOptions['createClient']>>

function connectorWith(client: RedisClientLikeForTest) {
  return createRedisConnector({
    resolveHost: async () => ['203.0.113.10'],
    createClient: () => client,
  })
}

function fakeClient(overrides: Partial<RedisClientLikeForTest> = {}): RedisClientLikeForTest {
  let open = false
  return {
    get isOpen() { return open },
    on() { return this },
    connect: async () => { open = true },
    close: async () => { open = false },
    destroy: () => { open = false },
    ping: async () => 'PONG',
    set: async () => 'OK',
    eval: async () => ['none', -2],
    ...overrides,
  }
}

function source(overrides: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: 'redis-source',
    projectId: 'project-1',
    publishedAgentId: null,
    kind: 'redis',
    label: 'Redis',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'custom',
      values: {
        host: 'cache.example.com',
        port: 6380,
        username: 'integration',
        password: 'not-a-real-secret',
        database: 2,
        ...overrides,
      },
    },
    status: 'active',
  }
}
