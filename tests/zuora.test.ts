import { afterEach, describe, expect, it, vi } from 'vitest'
import { zuoraConnector } from '../src/connectors/adapters/zuora'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const ZUORA_API_BASE_URLS = [
  'https://rest.test.zuora.com',
  'https://rest.sandbox.na.zuora.com',
  'https://rest.apisandbox.zuora.com',
  'https://rest.na.zuora.com',
  'https://rest.zuora.com',
  'https://rest.test.eu.zuora.com',
  'https://rest.sandbox.eu.zuora.com',
  'https://rest.eu.zuora.com',
  'https://rest.test.ap.zuora.com',
  'https://rest.ap.zuora.com',
] as const

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zuora_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zuora',
    label: 'Zuora test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiBaseUrl: 'https://rest.zuora.com' },
    credentials: { kind: 'oauth2', accessToken: 'zuora_token' },
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

afterEach(() => vi.unstubAllGlobals())

describe('zuoraConnector', () => {
  const connector = zuoraConnector

  it('exports a connector with correct manifest structure', () => {
    expect(connector).toBeDefined()
    expect(connector.manifest.kind).toBe('zuora')
  })

  it('manifest has correct kind and category', () => {
    expect(connector.manifest.kind).toBe('zuora')
    expect(connector.manifest.category).toBe('crm')
  })

  it('uses client credentials against the selected data center with no browser authorization flow', () => {
    const auth = connector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('zuora auth must be oauth2')
    expect(auth.grantType).toBe('client_credentials')
    expect(auth.authorizationUrl).toBeUndefined()
    expect(auth.tokenUrl).toBe('{apiBaseUrl}/oauth/token')
    expect(auth.scopes).toEqual([])
    expect(auth.tokenClientAuthMethod).toBe('client_secret_post')
    expect(auth.pkce).toBe('unsupported')
    expect(auth.urlTemplateMetadata).toEqual({
      apiBaseUrl: {
        kind: 'base-url',
        allowedBaseUrls: ZUORA_API_BASE_URLS,
      },
    })
  })

  it('accepts all ten documented data-center roots and uses each root for API execution', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ success: true })
    ))
    vi.stubGlobal('fetch', fetchMock)

    for (const apiBaseUrl of ZUORA_API_BASE_URLS) {
      await expect(connector.test(source({ metadata: { apiBaseUrl } }))).resolves.toEqual({ ok: true })
    }

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      ZUORA_API_BASE_URLS.map((apiBaseUrl) => `${apiBaseUrl}/v1/accounts`),
    )
  })

  it('rejects an unlisted data-center root before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      connector.test(source({ metadata: { apiBaseUrl: 'https://zuora.attacker.example' } })),
    ).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('has the expected capabilities', () => {
    const names = connector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('accounts.find')
    expect(names).toContain('products.find')
    expect(names).toContain('products.rate_plans.find')
    expect(names).toContain('invoices.create')
    expect(names).toContain('subscriptions.create')
    expect(names).toContain('subscriptions.cancel')
    expect(names).toContain('subscriptions.update')
    expect(names).toContain('payments.create')
  })

  it('has read capabilities for account and product lookups', () => {
    const readCaps = connector.manifest.capabilities.filter((c) => c.class === 'read')
    expect(readCaps.length).toBeGreaterThan(0)
    expect(readCaps.some((c) => c.name === 'accounts.find')).toBe(true)
    expect(readCaps.some((c) => c.name === 'products.find')).toBe(true)
  })

  it('has mutation capability for invoice creation', () => {
    const invoiceCreate = connector.manifest.capabilities.find((c) => c.name === 'invoices.create')
    expect(invoiceCreate).toBeDefined()
    expect(invoiceCreate?.class).toBe('mutation')
  })

  it('marks every mutation as native-idempotency with external effect', () => {
    for (const cap of connector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('zuora subscriptions.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/subscriptions with the subscription body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? String(init.body) : undefined
      return jsonResponse({ subscriptionId: 'sub_123', success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zuoraConnector.executeMutation!({
      source: source({ metadata: { apiBaseUrl: 'https://rest.eu.zuora.com' } }),
      capabilityName: 'subscriptions.create',
      args: {
        accountKey: 'acct_1',
        contractEffectiveDate: '2026-06-02',
        subscribeToRatePlans: [{ productRatePlanId: 'prp_1' }],
      },
      idempotencyKey: 'k-create-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://rest.eu.zuora.com/v1/subscriptions')
    expect(requestBody).toContain('acct_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      zuoraConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscriptions.create',
        args: {
          accountKey: 'acct_1',
          contractEffectiveDate: '2026-06-02',
          subscribeToRatePlans: [{ productRatePlanId: 'prp_1' }],
        },
        idempotencyKey: 'k-create-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('zuora subscriptions.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /v1/subscriptions/{key}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ success: true, cancelledDate: '2026-06-02' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zuoraConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.cancel',
      args: { subscriptionKey: 'sub_abc', cancellationPolicy: 'EndOfCurrentTerm' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v1/subscriptions/sub_abc/cancel')
  })
})

describe('zuora subscriptions.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs the amendment body to /v1/subscriptions/{key}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zuoraConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.update',
      args: { subscriptionKey: 'sub_z', add: [{ productRatePlanId: 'prp_2' }] },
      idempotencyKey: 'k-update-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/v1/subscriptions/sub_z')
    expect(String(requestUrl)).not.toContain('/cancel')
  })
})

describe('zuora payments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the payment body to /v1/payments', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? String(init.body) : undefined
      return jsonResponse({ paymentId: 'pay_1', success: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zuoraConnector.executeMutation!({
      source: source(),
      capabilityName: 'payments.create',
      args: {
        accountId: 'acct_1',
        amount: 19.99,
        currency: 'USD',
        effectiveDate: '2026-06-02',
        paymentMethodId: 'pm_1',
      },
      idempotencyKey: 'k-pay-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/payments')
    expect(requestBody).toContain('USD')
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      zuoraConnector.executeMutation!({
        source: source(),
        capabilityName: 'payments.create',
        args: {
          accountId: 'acct_1',
          amount: 1,
          currency: 'USD',
          effectiveDate: '2026-06-02',
          paymentMethodId: 'pm_1',
        },
        idempotencyKey: 'k-pay-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
