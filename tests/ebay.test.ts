import { afterEach, describe, expect, it, vi } from 'vitest'
import { ebayConnector } from '../src/connectors/adapters/ebay.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'
import { resolveConnectorAuthSpec } from '../src/specs/index.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_ebay_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'ebay',
    label: 'eBay test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ebay-test-token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ebay adapter manifest', () => {
  it('declares OAuth2 with the real eBay authorize / token endpoints and env-var names', () => {
    const auth = ebayConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://auth.ebay.com/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://api.ebay.com/identity/v1/oauth2/token')
    expect(auth.clientIdEnv).toBe('EBAY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('EBAY_OAUTH_CLIENT_SECRET')
    expect(auth.tokenClientAuthMethod).toBe('client_secret_basic')
    expect(resolveConnectorAuthSpec('ebay')?.tokenClientAuthMethod).toBe('client_secret_basic')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'https://api.ebay.com/oauth/api_scope',
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.marketing',
        'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
      ]),
    )
  })

})

describe('ebay listing.end', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to sell/inventory/v1/offer/{offerId}/withdraw', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ listingId: 'lst_1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await ebayConnector.executeMutation!({
      source: source(),
      capabilityName: 'listing.end',
      args: { offerId: 'offer_1' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe(
      'https://api.ebay.com/sell/inventory/v1/offer/offer_1/withdraw',
    )
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      ebayConnector.executeMutation!({
        source: source(),
        capabilityName: 'listing.end',
        args: { offerId: 'offer_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('ebay inventory.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the bulk_update_price_quantity endpoint with the requests array', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ responses: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const requests = [
      {
        sku: 'sku_1',
        shipToLocationAvailability: { quantity: 7 },
      },
    ]
    const result = await ebayConnector.executeMutation!({
      source: source(),
      capabilityName: 'inventory.update',
      args: { requests, marketplaceId: 'EBAY_US' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toBe(
      'https://api.ebay.com/sell/inventory/v1/bulk_update_price_quantity',
    )
    expect(requestBody).toEqual({ requests })
  })
})

describe('ebay orders.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to post-order/v2/cancellation with legacy id and reason', async () => {
    let requestUrl: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ cancelId: 'c_1' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await ebayConnector.executeMutation!({
      source: source(),
      capabilityName: 'orders.cancel',
      args: {
        legacyOrderId: '111-222',
        cancelReason: 'OUT_OF_STOCK_OR_CANNOT_FULFILL',
        marketplaceId: 'EBAY_US',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toBe('https://api.ebay.com/post-order/v2/cancellation')
    expect(requestBody).toEqual({
      legacyOrderId: '111-222',
      cancelReason: 'OUT_OF_STOCK_OR_CANNOT_FULFILL',
    })
  })
})
