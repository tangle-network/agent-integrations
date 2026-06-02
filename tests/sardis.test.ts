import { afterEach, describe, expect, it, vi } from 'vitest'
import { sardisConnector } from '../src/connectors/adapters/sardis.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sardis_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sardis',
    label: 'sardis test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'sardis_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('sardis adapter manifest', () => {
  it('classifies itself as the crm category and exposes the sardis kind', () => {
    expect(sardisConnector.manifest.kind).toBe('sardis')
    expect(sardisConnector.manifest.category).toBe('crm')
    expect(sardisConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = sardisConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Sardis/i)
  })

  it('covers payment, balance, policy, and transaction capability surface', () => {
    const names = sardisConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'balance.check',
        'balance.update',
        'payment.refund',
        'payment.send',
        'policy.check',
        'policy.delete',
        'policy.set',
        'transactions.get',
        'transactions.list',
      ].sort(),
    )
    const mutations = sardisConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'balance.update',
        'payment.refund',
        'payment.send',
        'policy.delete',
        'policy.set',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of sardisConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('sardis payment.refund', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /payment/refund with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ refundId: 'rfnd_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sardisConnector.executeMutation!({
      source: source(),
      capabilityName: 'payment.refund',
      args: { transactionId: 'txn_1', reason: 'duplicate charge' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.sardis.io/v1/payment/refund')
    expect(requestBody).toMatchObject({ transactionId: 'txn_1', reason: 'duplicate charge' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sardisConnector.executeMutation!({
        source: source(),
        capabilityName: 'payment.refund',
        args: { transactionId: 'txn_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sardis policy.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /policy/{agentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sardisConnector.executeMutation!({
      source: source(),
      capabilityName: 'policy.delete',
      args: { agentId: 'agent_42' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.sardis.io/v1/policy/agent_42')
    expect(result.status).toBe('committed')
  })
})

describe('sardis transactions.get', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs a single transaction by id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'txn_1', amount: 100 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sardisConnector.executeRead!({
      source: source(),
      capabilityName: 'transactions.get',
      args: { transactionId: 'txn_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('GET')
    expect(requestUrl).toBe('https://api.sardis.io/v1/transactions/txn_1')
    expect(result.data).toMatchObject({ id: 'txn_1' })
  })
})

describe('sardis balance.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /agent/balance with the signed amount', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ ok: true, balance: 1234 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sardisConnector.executeMutation!({
      source: source(),
      capabilityName: 'balance.update',
      args: { agentId: 'agent_1', amount: -2500, reason: 'manual debit' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.sardis.io/v1/agent/balance')
    expect(requestBody).toMatchObject({ agentId: 'agent_1', amount: -2500, reason: 'manual debit' })
  })
})
