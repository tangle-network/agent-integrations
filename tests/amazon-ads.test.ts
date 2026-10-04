import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAmazonAdsConnector } from '../src/connectors/adapters/amazon-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const adapter = createAmazonAdsConnector({ clientId: 'private-client-id' })
const source: ResolvedDataSource = { id: 'amazon', projectId: 'p', publishedAgentId: null, kind: 'amazon-ads', label: 'Amazon', consistencyModel: 'cache', scopes: ['advertising::campaign_management'], metadata: {}, credentials: { kind: 'oauth2', accessToken: 'private-token' }, status: 'active' }
function inv(capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation { return { source, capabilityName, args: { profileId: '123', ...args }, idempotencyKey: 'once' } }
function transport(data: unknown = { campaigns: { success: [{ index: 0, campaignId: '42' }], error: [] } }, status = 207) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status })) }
afterEach(() => vi.restoreAllMocks())

describe('Amazon Sponsored Products v3 wire contract', () => {
  it('discovers regional profiles with application identity and OAuth, without an account scope', async () => {
    const fetch = transport([{ profileId: 123, currencyCode: 'GBP' }], 200)
    await adapter.executeRead!({ ...inv('profiles.list'), source: { ...source, metadata: { apiBaseUrl: 'https://advertising-api-eu.amazon.com' } } })
    expect(String(fetch.mock.lastCall![0])).toBe('https://advertising-api-eu.amazon.com/v2/profiles')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ authorization: 'Bearer private-token', 'Amazon-Advertising-API-ClientId': 'private-client-id' })
    expect(fetch.mock.lastCall![1]?.headers).not.toHaveProperty('Amazon-Advertising-API-Scope')
    expect(JSON.stringify(adapter.manifest)).not.toContain('private-client-id')
  })
  it('rejects untrusted regional endpoints before sending credentials', async () => {
    const fetch = transport()
    await expect(adapter.executeRead!({ ...inv('profiles.list'), source: { ...source, metadata: { apiBaseUrl: 'https://untrusted.example' } } })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('creates a paused daily-currency campaign with dates and no dynamic upward bid adjustment', async () => {
    const fetch = transport()
    expect((await adapter.executeMutation!(inv('campaigns.createSponsoredProducts', { name: 'Products', dailyBudget: 10.25, startDate: '2026-10-05', endDate: '2026-10-08', state: 'ENABLED', budgetType: 'LIFETIME' }))).status).toBe('committed')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ 'Amazon-Advertising-API-Scope': '123', 'content-type': 'application/vnd.spCampaign.v3+json', accept: 'application/vnd.spCampaign.v3+json' })
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ campaigns: [{ name: 'Products', state: 'PAUSED', targetingType: 'MANUAL', budget: { budgetType: 'DAILY', budget: 10.25 }, startDate: '2026-10-05', endDate: '2026-10-08', dynamicBidding: { strategy: 'LEGACY_FOR_SALES' } }] })
  })
  it('requires an end date before requesting campaign creation', async () => {
    const fetch = transport()
    await expect(adapter.executeMutation!(inv('campaigns.createSponsoredProducts', { name: 'Products', dailyBudget: 10, startDate: '2026-10-05' }))).rejects.toThrow('missing required argument: endDate')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['adGroups.create', { campaignId: '42', name: 'Group', defaultBid: 0.5 }, 'adGroups', { campaignId: '42', name: 'Group', defaultBid: 0.5, state: 'PAUSED' }],
    ['keywords.create', { campaignId: '42', adGroupId: '43', keywordText: 'tea', matchType: 'EXACT', bid: 0.25 }, 'keywords', { campaignId: '42', adGroupId: '43', keywordText: 'tea', matchType: 'EXACT', bid: 0.25, state: 'PAUSED' }],
    ['productAds.createSellerProduct', { campaignId: '42', adGroupId: '43', sku: 'SKU-1', asin: 'injected' }, 'productAds', { campaignId: '42', adGroupId: '43', sku: 'SKU-1', state: 'PAUSED' }],
    ['productAds.createVendorProduct', { campaignId: '42', adGroupId: '43', asin: 'B000000001', sku: 'injected' }, 'productAds', { campaignId: '42', adGroupId: '43', asin: 'B000000001', state: 'PAUSED' }],
  ])('maps %s to its typed native single-item request', async (name, args, resource, expected) => {
    const key = resource === 'adGroups' ? 'adGroupId' : resource === 'keywords' ? 'keywordId' : 'adId'
    const fetch = transport({ [resource]: { success: [{ index: 0, [key]: '44' }], error: [] } })
    await adapter.executeMutation!(inv(name, args))
    expect(String(fetch.mock.lastCall![0])).toBe(`https://advertising-api.amazon.com/sp/${resource}`)
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ [resource]: [expected] })
  })
  it.each([['campaigns', 'campaignId'], ['adGroups', 'adGroupId'], ['keywords', 'keywordId'], ['productAds', 'adId']])('only changes %s identity and state when enabling or pausing', async (resource, key) => {
    const fetch = transport({ [resource]: { success: [{ index: 0 }], error: [] } })
    for (const [action, state] of [['enable', 'ENABLED'], ['pause', 'PAUSED']]) {
      await adapter.executeMutation!(inv(`${resource}.${action}`, { entityId: '42', budget: 999 }))
      expect(fetch.mock.lastCall![1]?.method).toBe('PUT')
      expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ [resource]: [{ [key]: '42', state }] })
    }
  })
  it('preserves campaign pagination and asynchronously requests then polls reports', async () => {
    const fetch = transport({ campaigns: [], nextToken: 'next' }, 200)
    expect((await adapter.executeRead!(inv('campaigns.list', { nextToken: 'previous' }))).data).toMatchObject({ nextToken: 'next' })
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ nextToken: 'previous', maxResults: 100 })
    fetch.mockResolvedValue(new Response('{"reportId":"r-1"}'))
    await adapter.executeRead!(inv('reports.requestCampaigns', { startDate: '2026-10-01', endDate: '2026-10-02' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toMatchObject({ configuration: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns', format: 'GZIP_JSON', timeUnit: 'DAILY', groupBy: ['campaign'] } })
    fetch.mockResolvedValue(new Response('{"status":"COMPLETED","url":"https://download.example/report"}'))
    const report = await adapter.executeRead!(inv('reports.get', { reportId: 'r-1' }))
    expect(report.data).toMatchObject({ status: 'COMPLETED' })
    expect(String(fetch.mock.lastCall![0])).toBe('https://advertising-api.amazon.com/reporting/reports/r-1')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('treats HTTP207 item errors as failure and protects both credentials on HTTP errors', async () => {
    const fetch = transport({ campaigns: { success: [], error: [{ index: 0, errors: [{ message: 'private-token private-client-id' }] }] } })
    await expect(adapter.executeMutation!(inv('campaigns.enable', { entityId: '42' }))).rejects.toThrow('1 provider errors')
    fetch.mockResolvedValue(new Response('private-token private-client-id account not eligible', { status: 403 }))
    await expect(adapter.executeRead!(inv('profiles.list'))).rejects.toThrow('[REDACTED] [REDACTED] account not eligible')
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(adapter.executeRead!(inv('profiles.list'))).rejects.toBeInstanceOf(CredentialsExpired)
  })
  it.each([{}, null, { campaigns: { success: [], error: [] } }, { campaigns: { success: [{ index: 1 }], error: [] } }])('rejects a missing or mismatched single-item receipt %j', async receipt => {
    transport(receipt)
    await expect(adapter.executeMutation!(inv('campaigns.enable', { entityId: '42' }))).rejects.toThrow('reconcile provider state')
  })
  it('requires an ID on creation, accepts representation receipts, and rejects malformed JSON', async () => {
    const fetch = transport({ adGroups: { success: [{ index: 0 }], error: [] } })
    const create = inv('adGroups.create', { campaignId: '42', name: 'Group', defaultBid: 0.5 })
    await expect(adapter.executeMutation!(create)).rejects.toThrow('no created entity ID')
    fetch.mockResolvedValue(new Response('{"adGroups":{"success":[{"index":0,"adGroup":{"adGroupId":"43"}}],"error":[]}}', { status: 207 }))
    expect((await adapter.executeMutation!(create)).status).toBe('committed')
    fetch.mockResolvedValue(new Response('<html>upstream failure</html>'))
    await expect(adapter.executeMutation!(inv('campaigns.pause', { entityId: '42' }))).rejects.toThrow('no resource receipt')
  })
})
