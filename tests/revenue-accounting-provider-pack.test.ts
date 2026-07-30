import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  billComConnector,
  brexConnector,
  chargebeeConnector,
  netsuiteConnector,
  paddleConnector,
  plaidConnector,
  rampConnector,
  resolveConnectorAdapterFactoryOptions,
  sageIntacctConnector,
  stripePackConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorAdapter, ResolvedDataSource } from '../src/connectors/types.js'

const expectedProviders = [
  'stripe-pack',
  'chargebee',
  'paddle',
  'plaid',
  'ramp',
  'brex',
  'bill-com',
  'netsuite',
  'sage-intacct',
] as const

function source(
  kind: string,
  credentials: ResolvedDataSource['credentials'] = { kind: 'api-key', apiKey: 'token' },
  metadata: Record<string, unknown> = {},
): ResolvedDataSource {
  return {
    id: `src_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials,
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('revenue and accounting provider factories', () => {
  it('registers all nine customer-credential provider packs without shared deployment secrets', () => {
    const implementations: ConnectorAdapter[] = [
      stripePackConnector,
      chargebeeConnector,
      paddleConnector,
      plaidConnector,
      rampConnector,
      brexConnector,
      billComConnector,
      netsuiteConnector,
      sageIntacctConnector,
    ]
    expect(implementations.map((adapter) => adapter.manifest.kind)).toEqual(expectedProviders)
    for (const kind of expectedProviders) {
      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual({})
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toEqual({})
      expect(definition!.factory({}).manifest.capabilities.length, kind).toBeGreaterThan(0)
    }
  })
})

describe('structured finance credentials', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('injects Plaid secrets after arguments so callers cannot replace or observe them', async () => {
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ accounts: [] })
    }))

    await plaidConnector.executeRead!({
      source: source(
        'plaid',
        { kind: 'custom', values: { clientId: 'client-real', secret: 'secret-real', accessToken: 'access-real' } },
        { environmentBaseUrl: 'https://sandbox.plaid.com' },
      ),
      capabilityName: 'accounts.get',
      args: { client_id: 'caller-value', secret: 'caller-value', access_token: 'caller-value' },
      idempotencyKey: 'read_1',
    })

    expect(body).toEqual({
      client_id: 'client-real',
      secret: 'secret-real',
      access_token: 'access-real',
    })
  })

  it('sends BILL developer/session credentials only as headers', async () => {
    let headers = new Headers()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return jsonResponse({ results: [] })
    }))

    await billComConnector.executeRead!({
      source: source('bill-com', {
        kind: 'api-key',
        apiKey: JSON.stringify({ developerKey: 'dev-secret', sessionId: 'session-secret' }),
      }),
      capabilityName: 'vendors.list',
      args: { max: 1 },
      idempotencyKey: 'read_2',
    })

    expect(headers.get('devKey')).toBe('dev-secret')
    expect(headers.get('sessionId')).toBe('session-secret')
  })

  it('redacts individual values from JSON credential bundles', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'dev-secret session-secret' }, 500)))
    const call = billComConnector.executeRead!({
      source: source('bill-com', {
        kind: 'api-key',
        apiKey: JSON.stringify({ developerKey: 'dev-secret', sessionId: 'session-secret' }),
      }),
      capabilityName: 'vendors.list',
      args: {},
      idempotencyKey: 'read_json_redaction',
    })
    await expect(call).rejects.not.toThrow(/dev-secret|session-secret/)
    await expect(call).rejects.toThrow(/\[REDACTED\]/)
  })

  it('redacts every custom credential value from provider errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'client-real secret-real access-real' }, 500)))
    const call = plaidConnector.executeRead!({
      source: source(
        'plaid',
        { kind: 'custom', values: { clientId: 'client-real', secret: 'secret-real', accessToken: 'access-real' } },
        { environmentBaseUrl: 'https://sandbox.plaid.com' },
      ),
      capabilityName: 'accounts.get',
      args: {},
      idempotencyKey: 'read_3',
    })
    await expect(call).rejects.not.toThrow(/client-real|secret-real|access-real/)
    await expect(call).rejects.toThrow(/\[REDACTED\]/)
  })
})

describe('tenant endpoint boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows the connected NetSuite account host and rejects lookalike credential exfiltration hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })))
    const invocation = {
      source: source('netsuite', { kind: 'api-key', apiKey: 'oauth-token' }, {
        apiBaseUrl: 'https://123456.suitetalk.api.netsuite.com/services/rest',
      }),
      capabilityName: 'customers.list',
      args: { limit: 1 },
      idempotencyKey: 'read_4',
    }
    await expect(netsuiteConnector.executeRead!(invocation)).resolves.toMatchObject({ data: { items: [] } })

    await expect(netsuiteConnector.executeRead!({
      ...invocation,
      source: source('netsuite', { kind: 'api-key', apiKey: 'oauth-token' }, {
        apiBaseUrl: 'https://123456.suitetalk.api.netsuite.com.attacker.test/services/rest',
      }),
    })).rejects.toThrow('not an allowed provider endpoint')
  })

  it.each([
    [rampConnector, 'ramp', 'users.list', 'https://api.ramp.com/api/v1/users?page_size=1', {}],
    [brexConnector, 'brex', 'users.list', 'https://platform.brexapis.com/v2/users?limit=1', {}],
    [sageIntacctConnector, 'sage-intacct', 'vendors.list', 'https://api.intacct.com/ia/api/v1/objects/accounts-payable/vendor?limit=1', {}],
  ] as const)('routes %s through its pinned production API host', async (adapter, kind, capability, expectedUrl, metadata) => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return jsonResponse({ items: [] })
    }))
    await adapter.executeRead!({
      source: source(kind, { kind: 'api-key', apiKey: 'bearer-token' }, metadata),
      capabilityName: capability,
      args: { limit: 1, page_size: 1 },
      idempotencyKey: `read_${kind}`,
    })
    expect(url).toBe(expectedUrl)
  })
})
