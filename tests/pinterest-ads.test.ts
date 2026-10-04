import { afterEach, describe, expect, it, vi } from 'vitest'
import { pinterestAdsConnector as adapter } from '../src/connectors/adapters/pinterest-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = { id: 'pinterest', projectId: 'p', publishedAgentId: null, kind: 'pinterest-ads', label: 'Pinterest', consistencyModel: 'cache', scopes: ['ads:read', 'ads:write'], metadata: {}, credentials: { kind: 'oauth2', accessToken: 'private-token' }, status: 'active' }
function inv(capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation { return { source, capabilityName, args: { adAccountId: '123', ...args }, idempotencyKey: 'once' } }
function transport(data: unknown = { items: [{ data: { id: '42' }, exceptions: [] }] }, status = 200) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status })) }
afterEach(() => vi.restoreAllMocks())

describe('Pinterest Ads v5 wire contract', () => {
  it('discovers accounts and preserves pagination with OAuth', async () => {
    const fetch = transport({ items: [{ id: '123', currency: 'USD' }], bookmark: 'next' })
    const result = await adapter.executeRead!(inv('accounts.list', { bookmark: 'previous' }))
    expect(result.data).toMatchObject({ bookmark: 'next' })
    expect(String(fetch.mock.lastCall![0])).toBe('https://api.pinterest.com/v5/ad_accounts?bookmark=previous&page_size=100')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ authorization: 'Bearer private-token' })
  })
  it('posts a top-level array containing one paused campaign with a lifetime microcurrency cap', async () => {
    const fetch = transport()
    await adapter.executeMutation!(inv('campaigns.createConsideration', { name: 'Trial', lifetimeSpendCap: 100000000, startTime: 1791158400, endTime: 1791417600, status: 'ACTIVE', daily_spend_cap: 999999999 }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ name: 'Trial', objective_type: 'CONSIDERATION', status: 'PAUSED', is_campaign_budget_optimization: true, is_flexible_daily_budgets: false, is_performance_plus: false, is_automated_campaign: false, lifetime_spend_cap: 100000000, start_time: 1791158400, end_time: 1791417600 }])
    expect(String(fetch.mock.lastCall![0])).toBe('https://api.pinterest.com/v5/ad_accounts/123/campaigns')
  })
  it('requires the budget and end time before fetching', async () => {
    const fetch = transport()
    await expect(adapter.executeMutation!(inv('campaigns.createConsideration', { name: 'Trial', lifetimeSpendCap: 10, startTime: 100 }))).rejects.toThrow('missing required argument: endTime')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('creates targeted paused ad groups with inherited campaign budget and paused image-Pin ads', async () => {
    const fetch = transport()
    await adapter.executeMutation!(inv('adGroups.create', { campaignId: '42', name: 'Intent', bidMicros: 1000000, locations: ['US'], interests: ['944837'], locales: ['en'], auto_targeting_enabled: true }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ campaign_id: '42', name: 'Intent', status: 'PAUSED', billable_event: 'CLICKTHROUGH', bid_strategy_type: 'MAX_BID', bid_in_micro_currency: 1000000, auto_targeting_enabled: false, targeting_spec: { LOCATION: ['US'], INTEREST: ['944837'], LOCALE: ['en'] } }])
    await adapter.executeMutation!(inv('ads.createFromPin', { adGroupId: '43', pinId: '999', name: 'Creative', destinationUrl: 'https://example.com/?utm_source=pinterest' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ ad_group_id: '43', pin_id: '999', name: 'Creative', destination_url: 'https://example.com/?utm_source=pinterest', creative_type: 'REGULAR', status: 'PAUSED' }])
  })
  it.each(['campaigns', 'adGroups', 'ads'])('updates only %s identity and serving status', async resource => {
    const fetch = transport()
    for (const [action, status] of [['enable', 'ACTIVE'], ['pause', 'PAUSED']]) {
      await adapter.executeMutation!(inv(`${resource}.${action}`, { entityId: '42', status: 'ARCHIVED', lifetimeSpendCap: 999 }))
      expect(fetch.mock.lastCall![1]?.method).toBe('PATCH')
      expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ id: '42', status }])
    }
  })
  it('reads a date-bounded report with native microcurrency spend', async () => {
    const fetch = transport([{ DATE: '2026-10-01', SPEND_IN_MICRO_DOLLAR: 1000000 }])
    await adapter.executeRead!(inv('reports.account', { startDate: '2026-10-01', endDate: '2026-10-02' }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.searchParams.get('columns')).toBe('SPEND_IN_MICRO_DOLLAR,PAID_IMPRESSION,TOTAL_CLICKTHROUGH')
    expect(url.searchParams.get('granularity')).toBe('DAY')
  })
  it('fails native 200 batch exceptions without echoing request secrets', async () => {
    transport({ items: [{ exceptions: [{ code: 2, message: 'private-token' }] }] })
    await expect(adapter.executeMutation!(inv('campaigns.enable', { entityId: '42' }))).rejects.toThrow('1 provider exceptions')
  })
  it('distinguishes policy denial, expired OAuth and rate limiting', async () => {
    const fetch = transport({ message: 'permission denied private-token' }, 403)
    await expect(adapter.executeRead!(inv('accounts.list'))).rejects.toThrow('permission denied [REDACTED]')
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(adapter.executeRead!(inv('accounts.list'))).rejects.toBeInstanceOf(CredentialsExpired)
    fetch.mockResolvedValue(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
    expect(await adapter.executeMutation!(inv('campaigns.pause', { entityId: '42' }))).toMatchObject({ status: 'rate-limited', retryAfterMs: 2000 })
  })
})
