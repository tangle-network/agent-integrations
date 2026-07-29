import { describe, expect, it, vi, afterEach } from 'vitest'
import { quickbooksConnector } from '../src/connectors/adapters/quickbooks.js'
import { xeroConnector } from '../src/connectors/adapters/xero.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const REALM = '9341454792738105'

function source(kind: string, metadata: Record<string, unknown>): ResolvedDataSource {
  return {
    id: `src_${kind}_1`,
    projectId: 'proj_1',
    publishedAgentId: null,
    kind,
    label: `${kind} test`,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'oauth2', accessToken: 'access-token' },
    status: 'active',
  }
}

const qbo = () =>
  source('quickbooks', {
    apiBaseUrl: `https://quickbooks.api.intuit.com/v3/company/${REALM}`,
    realmId: REALM,
  })

/** Capture the outgoing request and reply with `body` at `status`. */
function stubFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; method?: string; headers?: HeadersInit }> = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, headers: init?.headers })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })
  })
  vi.stubGlobal('fetch', impl)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quickbooks connection health check', () => {
  it('reads realmId from connection metadata and actually calls the company endpoint', async () => {
    const calls = stubFetch(200, { CompanyInfo: { CompanyName: 'Acme' } })

    const result = await quickbooksConnector.test(qbo())

    // Before the `{connection.*}` scope existed this threw
    // "missing required argument: realmId" with ZERO requests made, so the
    // health check reported red for every connection that was in fact healthy.
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(
      `https://quickbooks.api.intuit.com/v3/company/${REALM}/companyinfo/${REALM}?minorversion=70`,
    )
  })
})

describe('quickbooks tax read surface', () => {
  it('builds a P&L report request against the connection realm', async () => {
    const calls = stubFetch(200, { Header: { ReportName: 'ProfitAndLoss' } })

    await quickbooksConnector.executeRead!({
      source: qbo(),
      capabilityName: 'reports.get',
      args: {
        reportName: 'ProfitAndLoss',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
        accounting_method: 'Accrual',
      },
      idempotencyKey: 'k',
    })

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe(`/v3/company/${REALM}/reports/ProfitAndLoss`)
    expect(url.searchParams.get('start_date')).toBe('2025-01-01')
    expect(url.searchParams.get('end_date')).toBe('2025-12-31')
    expect(url.searchParams.get('accounting_method')).toBe('Accrual')
  })

  it('covers the statements a return is built from', () => {
    const reports = quickbooksConnector.manifest.capabilities.find((c) => c.name === 'reports.get')
    const enumerated = (reports?.parameters as { properties: { reportName: { enum: string[] } } }).properties
      .reportName.enum
    expect(enumerated).toEqual(
      expect.arrayContaining(['ProfitAndLoss', 'BalanceSheet', 'TrialBalance', 'GeneralLedger']),
    )
  })
})

describe('a non-commit must never be reported as a commit', () => {
  it('maps a 409 CAS conflict to status=conflict', async () => {
    stubFetch(409, 'stale SyncToken')

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.update',
      args: { Id: '1', SyncToken: '0', DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('conflict')
  })

  it('maps a 429 throttle to status=rate-limited with a real wait', async () => {
    stubFetch(429, 'throttled', { 'retry-after': '30' })

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.create',
      args: { DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('rate-limited')
    if (result.status === 'rate-limited') expect(result.retryAfterMs).toBe(30_000)
  })

  it('maps a 412 precondition failure to conflict, same as a 409', async () => {
    stubFetch(412, 'precondition failed')

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.update',
      args: { Id: '1', SyncToken: '0', DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('conflict')
  })

  it('reports the upstream body as current state, not the transport wrapper', async () => {
    // `currentState` is contractually "the current authoritative state". It
    // used to receive the transport's own `{status:'conflict', message}`
    // object, with the provider's parsed JSON discarded — so a caller diffing
    // against its attempted write got a wrapper it could do nothing with.
    const upstream = {
      Fault: { Error: [{ code: '5010', Message: 'Stale Object Error' }] },
      SyncToken: '4',
    }
    stubFetch(409, upstream)

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.update',
      args: { Id: '1', SyncToken: '0', DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('conflict')
    if (result.status !== 'conflict') return
    expect(result.currentState).toEqual(upstream)
    expect((result.currentState as { SyncToken?: string }).SyncToken).toBe('4')
  })

  it('does not reclassify a successful write whose body carries status:conflict', async () => {
    // ~200 connectors share this transport. The outcome tag used to be read
    // off `data.status`, indistinguishable from an upstream field of the same
    // name, so a 200 body like this would report a landed write as a failure
    // and the caller would abort or retry a write that already happened.
    stubFetch(200, { Customer: { Id: '99' }, status: 'conflict' })

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.create',
      args: { DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('committed')
  })

  it('never returns a zero wait on an explicit Retry-After: 0', async () => {
    // Legal HTTP, sent when a bucket has already refilled — but honouring it
    // literally turns a throttle into a busy-loop against the upstream.
    stubFetch(429, 'throttled', { 'retry-after': '0' })

    const result = await quickbooksConnector.executeMutation!({
      source: qbo(),
      capabilityName: 'customers.create',
      args: { DisplayName: 'Acme' },
      idempotencyKey: 'k',
    })

    expect(result.status).toBe('rate-limited')
    if (result.status === 'rate-limited') expect(result.retryAfterMs).toBeGreaterThan(0)
  })
})

describe('credentials reach the wire', () => {
  it('sends the connection access token as a bearer header', async () => {
    // Every bearer connector shares `applyCredentials`. A regression there
    // would send unauthenticated requests, and no test inspected the outgoing
    // authorization header — the stub ignores headers, so the suite stayed
    // green while the product broke.
    const calls = stubFetch(200, {})

    await quickbooksConnector.executeRead!({
      source: qbo(),
      capabilityName: 'companyinfo.get',
      args: {},
      idempotencyKey: 'k',
    })

    expect(new Headers(calls[0].headers).get('authorization')).toBe('Bearer access-token')
  })
})

describe('xero tenant discovery', () => {
  it('exposes a capability that returns the tenantId every other call requires', async () => {
    const calls = stubFetch(200, [{ tenantId: 'abc-123', tenantName: 'Acme Ltd' }])

    const result = await xeroConnector.executeRead!({
      source: source('xero', {}),
      capabilityName: 'tenants.list',
      args: {},
      idempotencyKey: 'k',
    })

    expect(calls[0].url).toBe('https://api.xero.com/connections')
    expect(result.data).toEqual([{ tenantId: 'abc-123', tenantName: 'Acme Ltd' }])
  })

  it('sends the tenant id as a header on a report read', async () => {
    const calls = stubFetch(200, { Reports: [] })

    await xeroConnector.executeRead!({
      source: source('xero', {}),
      capabilityName: 'reports.get',
      args: { tenantId: 'abc-123', reportName: 'BalanceSheet', date: '2025-12-31' },
      idempotencyKey: 'k',
    })

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/api.xro/2.0/Reports/BalanceSheet')
    expect(url.searchParams.get('date')).toBe('2025-12-31')
    expect((calls[0].headers as Record<string, string>)['xero-tenant-id']).toBe('abc-123')
  })

  it('requests the reports scope the reports namespace needs', () => {
    const auth = xeroConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') expect(auth.scopes).toContain('accounting.reports.read')
  })
})

describe('arguments and connection metadata stay distinct', () => {
  it('does not let a connection field shadow a caller-supplied argument', async () => {
    const calls = stubFetch(200, {})

    await quickbooksConnector.executeRead!({
      source: qbo(),
      capabilityName: 'customers.get',
      // `customerId` is an argument; the connection also carries `realmId`.
      // Both namespaces must stay addressable and distinct.
      args: { customerId: '42' },
      idempotencyKey: 'k',
    })

    expect(new URL(calls[0].url).pathname).toBe(`/v3/company/${REALM}/customer/42`)
  })
})

describe('the tenant a connection is pinned to is not caller-addressable', () => {
  // Arguments on this path are model-authored. If a per-call argument can
  // reach the identifier that selects WHOSE books are read, then a prompt
  // injection or a hallucinated field is enough to point a trusted OAuth
  // token at another company's data.
  const FOREIGN_REALM = '1111111111111111'

  it('ignores an argument that tries to re-address the QuickBooks realm', async () => {
    const calls = stubFetch(200, {})

    await quickbooksConnector.executeRead!({
      source: qbo(),
      capabilityName: 'companyinfo.get',
      // `companyinfo.get` resolves its realm from `{connection.realmId}`.
      // Supplying an argument named `connection` must not redirect it.
      args: { connection: { realmId: FOREIGN_REALM } },
      idempotencyKey: 'k',
    })

    const pathname = new URL(calls[0].url).pathname
    expect(pathname).toBe(`/v3/company/${REALM}/companyinfo/${REALM}`)
    expect(pathname).not.toContain(FOREIGN_REALM)
  })

  it('keeps the health check pinned to the connection realm under a hostile argument', async () => {
    const calls = stubFetch(200, { CompanyInfo: { CompanyName: 'Acme' } })

    await quickbooksConnector.executeRead!({
      source: qbo(),
      capabilityName: 'companyinfo.get',
      args: { connection: { realmId: FOREIGN_REALM }, realmId: FOREIGN_REALM },
      idempotencyKey: 'k',
    })

    expect(new URL(calls[0].url).pathname.endsWith(`/companyinfo/${REALM}`)).toBe(true)
  })

  it('refuses a Xero read that carries no tenant instead of guessing one', async () => {
    stubFetch(200, {})

    // Xero addresses every call with the `xero-tenant-id` header. An absent
    // tenant must fail loudly here — a request that omitted the header would
    // be resolved by Xero against the connection's default organisation,
    // which is silently the wrong company whenever a user authorised more
    // than one.
    await expect(
      xeroConnector.executeRead!({
        source: source('xero', {}),
        capabilityName: 'reports.get',
        args: { reportName: 'ProfitAndLoss' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/tenantId/)
  })

  it('sends exactly the tenant it was given, and never an empty header', async () => {
    const calls = stubFetch(200, {})

    await xeroConnector.executeRead!({
      source: source('xero', {}),
      capabilityName: 'reports.get',
      args: { tenantId: 'tenant-abc', reportName: 'ProfitAndLoss' },
      idempotencyKey: 'k',
    })

    const headers = new Headers(calls[0].headers)
    expect(headers.get('xero-tenant-id')).toBe('tenant-abc')
  })
})
