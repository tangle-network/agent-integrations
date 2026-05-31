import { afterEach, describe, expect, it, vi } from 'vitest'
import { quickbooksConnector } from '../quickbooks.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../../types.js'

const realmId = '4620816365275777583'
const source: ResolvedDataSource = {
  id: 'src_quickbooks',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'quickbooks',
  label: 'QuickBooks (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['com.intuit.quickbooks.accounting'],
  metadata: {
    apiBaseUrl: `https://quickbooks.api.intuit.com/v3/company/${realmId}`,
    realmId,
  },
  credentials: { kind: 'oauth2', accessToken: 'token_qb' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('quickbooks adapter manifest', () => {
  it('declares the expected OAuth2 endpoints, scopes, and env-var names', () => {
    const auth = quickbooksConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://appcenter.intuit.com/connect/oauth2')
    expect(auth.tokenUrl).toBe('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    expect(auth.scopes).toEqual(['com.intuit.quickbooks.accounting'])
    expect(auth.clientIdEnv).toBe('QUICKBOOKS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('QUICKBOOKS_OAUTH_CLIENT_SECRET')
  })

  it('exposes the finance action pack (query, customers, invoices, items, payments) split between reads and mutations', () => {
    const names = quickbooksConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'entities.query',
        'customers.get',
        'customers.create',
        'customers.update',
        'invoices.get',
        'invoices.create',
        'invoices.update',
        'items.create',
        'payments.create',
      ].sort(),
    )
    const reads = quickbooksConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = quickbooksConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['customers.get', 'entities.query', 'invoices.get'])
    expect(mutations).toEqual([
      'customers.create',
      'customers.update',
      'invoices.create',
      'invoices.update',
      'items.create',
      'payments.create',
    ])
  })

  it('classifies itself as commerce (finance/accounting) with authoritative consistency', () => {
    expect(quickbooksConnector.manifest.kind).toBe('quickbooks')
    expect(quickbooksConnector.manifest.category).toBe('commerce')
    expect(quickbooksConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('requires the QuickBooks accounting scope on every capability', () => {
    for (const capability of quickbooksConnector.manifest.capabilities) {
      expect(capability.requiredScopes).toContain('com.intuit.quickbooks.accounting')
    }
  })
})

describe('quickbooks adapter execution', () => {
  it('builds entities.query against the per-realm base URL with bearer auth', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Acme' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'entities.query',
      args: { query: "SELECT * FROM Customer WHERE Active = true MAXRESULTS 10", minorversion: '70' },
      idempotencyKey: 'idem_q1',
    }
    const result = await quickbooksConnector.executeRead!(invocation)

    expect(result.data).toMatchObject({ QueryResponse: { Customer: [{ Id: '1', DisplayName: 'Acme' }] } })
    const call = fetchMock.mock.calls[0]!
    const url = String(call[0])
    expect(url.startsWith(`https://quickbooks.api.intuit.com/v3/company/${realmId}/query?`)).toBe(true)
    expect(url).toContain('query=SELECT+*+FROM+Customer')
    expect(url).toContain('minorversion=70')
    const headers = call[1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_qb')
    expect(headers.accept).toBe('application/json')
  })

  it('POSTs customers.create with the args body to /customer', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ Customer: { Id: '42', DisplayName: 'Tangle', SyncToken: '0' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'customers.create',
      args: {
        DisplayName: 'Tangle',
        CompanyName: 'Tangle Network',
        PrimaryEmailAddr: { Address: 'billing@tangle.tools' },
      },
      idempotencyKey: 'idem_q2',
    }
    const result = await quickbooksConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const call = fetchMock.mock.calls[0]!
    const url = String(call[0])
    expect(url.startsWith(`https://quickbooks.api.intuit.com/v3/company/${realmId}/customer?`)).toBe(true)
    expect(url).toContain('minorversion=70')
    expect(call[1]!.method).toBe('POST')
    expect(JSON.parse(String(call[1]!.body))).toMatchObject({
      DisplayName: 'Tangle',
      CompanyName: 'Tangle Network',
      PrimaryEmailAddr: { Address: 'billing@tangle.tools' },
    })
  })

  it('GETs invoices.get at the invoice-id path under the realm base', async () => {
    const fetchMock = vi.fn(
      async (_input: URL | string, _init?: RequestInit) =>
        new Response(JSON.stringify({ Invoice: { Id: 'inv_99', TotalAmt: 250 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'invoices.get',
      args: { invoiceId: 'inv_99' },
      idempotencyKey: 'idem_q3',
    }
    const result = await quickbooksConnector.executeRead!(invocation)

    expect(result.data).toMatchObject({ Invoice: { Id: 'inv_99' } })
    const call = fetchMock.mock.calls[0]!
    expect(String(call[0]).startsWith(
      `https://quickbooks.api.intuit.com/v3/company/${realmId}/invoice/inv_99`,
    )).toBe(true)
    expect(call[1]!.method).toBe('GET')
  })

  it('throws CredentialsExpired when QuickBooks rejects the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response('token expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'customers.get',
      args: { customerId: '42' },
      idempotencyKey: 'idem_q4',
    }
    await expect(quickbooksConnector.executeRead!(invocation)).rejects.toMatchObject({
      name: 'CredentialsExpired',
    })
  })
})
