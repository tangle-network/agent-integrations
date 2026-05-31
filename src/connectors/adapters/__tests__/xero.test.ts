import { afterEach, describe, expect, it, vi } from 'vitest'
import { xeroConnector } from '../xero.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'src_xero',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'xero',
  label: 'Xero (Acme)',
  consistencyModel: 'authoritative',
  scopes: ['accounting.contacts', 'accounting.transactions', 'accounting.settings.read'],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('xero adapter manifest', () => {
  it('declares the documented Xero Identity OAuth2 endpoints, scopes, and env-var names', () => {
    const auth = xeroConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://login.xero.com/identity/connect/authorize')
    expect(auth.tokenUrl).toBe('https://identity.xero.com/connect/token')
    expect(auth.scopes).toEqual([
      'offline_access',
      'accounting.contacts',
      'accounting.transactions',
      'accounting.settings.read',
    ])
    expect(auth.clientIdEnv).toBe('XERO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('XERO_OAUTH_CLIENT_SECRET')
  })

  it('classifies itself as crm with authoritative consistency', () => {
    expect(xeroConnector.manifest.kind).toBe('xero')
    expect(xeroConnector.manifest.displayName).toBe('Xero')
    expect(xeroConnector.manifest.category).toBe('crm')
    expect(xeroConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('passes the shared manifest validator', () => {
    const result = validateConnectorManifest(xeroConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('exposes the accounting action pack split between reads and mutations with scope gating', () => {
    const names = xeroConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.search',
        'contacts.get',
        'contacts.create',
        'contacts.update',
        'invoices.search',
        'invoices.get',
        'invoices.create',
        'accounts.search',
      ].sort(),
    )
    const reads = xeroConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutations = xeroConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(reads.sort()).toEqual(['accounts.search', 'contacts.get', 'contacts.search', 'invoices.get', 'invoices.search'])
    expect(mutations.sort()).toEqual(['contacts.create', 'contacts.update', 'invoices.create'])

    const contactRead = xeroConnector.manifest.capabilities.find((c) => c.name === 'contacts.search')!
    expect(contactRead.requiredScopes).toEqual(['accounting.contacts'])
    const invoiceCreate = xeroConnector.manifest.capabilities.find((c) => c.name === 'invoices.create')!
    expect(invoiceCreate.requiredScopes).toEqual(['accounting.transactions'])
    const accountsRead = xeroConnector.manifest.capabilities.find((c) => c.name === 'accounts.search')!
    expect(accountsRead.requiredScopes).toEqual(['accounting.settings.read'])
  })
})

describe('xero adapter execution', () => {
  it('sends contacts.search to the v2 API with bearer auth and the xero-tenant-id header populated from args', async () => {
    const fetchMock = mockFetch({ Contacts: [{ ContactID: 'c1', Name: 'Acme' }] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'contacts.search',
      args: { tenantId: 'tenant_abc', where: 'Name.Contains("Acme")', order: 'Name ASC' },
      idempotencyKey: 'idem_1',
    }
    const result = await xeroConnector.executeRead!(invocation)

    expect(result.data).toEqual({ Contacts: [{ ContactID: 'c1', Name: 'Acme' }] })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain('https://api.xero.com/api.xro/2.0/Contacts')
    expect(String(url)).toContain('where=')
    expect(String(url)).toContain('order=Name+ASC')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token_xyz')
    expect(headers['xero-tenant-id']).toBe('tenant_abc')
    expect(init.method).toBe('GET')
  })

  it('wraps invoices.create body in the Invoices array shape Xero expects', async () => {
    const fetchMock = mockFetch({ Invoices: [{ InvoiceID: 'inv_1', Status: 'DRAFT' }] }, { status: 200 })
    const lineItems = [{ Description: 'Consulting', Quantity: 1, UnitAmount: 1000, AccountCode: '200' }]
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'invoices.create',
      args: {
        tenantId: 'tenant_abc',
        Invoices: [
          {
            Type: 'ACCREC',
            Contact: { ContactID: 'c1' },
            LineItems: lineItems,
            Date: '2026-05-31',
            DueDate: '2026-06-30',
            Status: 'DRAFT',
          },
        ],
      },
      idempotencyKey: 'idem_2',
    }

    const result = await xeroConnector.executeMutation!(invocation)

    expect(result.status).toBe('committed')
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://api.xero.com/api.xro/2.0/Invoices')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['xero-tenant-id']).toBe('tenant_abc')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: 'c1' },
          LineItems: lineItems,
          Date: '2026-05-31',
          DueDate: '2026-06-30',
          Status: 'DRAFT',
        },
      ],
    })
  })

  it('throws CredentialsExpired when Xero rejects the access token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('expired', { status: 401 })),
    )
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'contacts.get',
      args: { tenantId: 'tenant_abc', contactId: 'c1' },
      idempotencyKey: 'idem_3',
    }
    await expect(xeroConnector.executeRead!(invocation)).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
