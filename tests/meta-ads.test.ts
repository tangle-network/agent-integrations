import { afterEach, describe, expect, it, vi } from 'vitest'
import { metaAdsConnector } from '../src/connectors/adapters/meta-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = { id: 'meta', projectId: 'project', publishedAgentId: null, kind: 'meta-ads', label: 'Ads', consistencyModel: 'cache',
  scopes: ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement'], metadata: {}, credentials: { kind: 'oauth2', accessToken: 'private-token' }, status: 'active' }
const invocation = (capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
function transport(data: unknown = { id: '42' }, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status }))
}
afterEach(() => vi.restoreAllMocks())

describe('Meta Ads provider wire contract', () => {
  it('discovers ad accounts and page identities without requesting page access tokens', async () => {
    const fetch = transport({ data: [], paging: { cursors: { after: 'next' }, next: 'https://graph.facebook.com/me/adaccounts?access_token=private-token&after=next' } })
    const result = await metaAdsConnector.executeRead!(invocation('accounts.list', { after: 'prior', limit: 10 }))
    expect(result.data).toMatchObject({ paging: { cursors: { after: 'next' } } })
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v25.0/me/adaccounts')
    expect(url.searchParams.has('access_token')).toBe(false)
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ authorization: 'Bearer private-token' })
    expect(JSON.stringify(result.data)).not.toContain('private-token')
    expect(result.data).toMatchObject({ paging: { cursors: { after: 'next' } } })
    expect(url.searchParams.get('after')).toBe('prior')
    await metaAdsConnector.executeRead!(invocation('pages.list'))
    expect(new URL(String(fetch.mock.lastCall![0])).searchParams.get('fields')).not.toContain('access_token')
  })

  it('pins paused creation and encodes aggregate cap and compound fields in Graph form format', async () => {
    const fetch = transport()
    await metaAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { accountId: '123', name: 'Trial', spendCap: 10000, specialAdCategories: [], status: 'ACTIVE', daily_budget: 999999 }))
    expect(new URL(String(fetch.mock.lastCall![0])).pathname).toBe('/v25.0/act_123/campaigns')
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({
      name: 'Trial', objective: 'OUTCOME_TRAFFIC', buying_type: 'AUCTION', status: 'PAUSED', spend_cap: '10000', special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false',
    })
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' })
    await metaAdsConnector.executeMutation!(invocation('adSets.createTraffic', {
      accountId: '123', campaignId: '42', name: 'Audience', lifetimeBudget: 10000, startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-07T00:00:00Z', countries: ['US'], ageMin: 25,
    }))
    const body = new URLSearchParams(String(fetch.mock.lastCall![1]?.body))
    expect(body.get('status')).toBe('PAUSED')
    expect(body.get('lifetime_budget')).toBe('10000')
    expect(body.has('daily_budget')).toBe(false)
    expect(JSON.parse(body.get('targeting')!)).toEqual({ geo_locations: { countries: ['US'] }, age_min: 25 })
  })

  it('constructs typed link creatives and paused ads, preserving tracked destination URLs', async () => {
    const fetch = transport()
    await metaAdsConnector.executeMutation!(invocation('creatives.createLink', {
      accountId: '123', name: 'Offer', pageId: '56', instagramUserId: '57', link: 'https://example.com/?utm_source=meta', imageUrl: 'https://example.com/ad.png',
      message: 'Meet your sales operator.', headline: 'Build your pipeline', callToAction: 'SIGN_UP',
    }))
    const creative = JSON.parse(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)).get('object_story_spec')!)
    expect(creative).toMatchObject({ page_id: '56', instagram_user_id: '57', link_data: { link: 'https://example.com/?utm_source=meta', call_to_action: { type: 'SIGN_UP' } } })
    await metaAdsConnector.executeMutation!(invocation('ads.create', { accountId: '123', name: 'Ad', adSetId: '44', creativeId: '42' }))
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({ name: 'Ad', adset_id: '44', creative: '{"creative_id":"42"}', status: 'PAUSED' })
  })

  it('changes only status and requests bounded attribution reporting', async () => {
    const fetch = transport({ success: true })
    await metaAdsConnector.executeMutation!(invocation('campaigns.enable', { objectId: '42', spendCap: 999999 }))
    expect(String(fetch.mock.lastCall![1]?.body)).toBe('status=ACTIVE')
    await metaAdsConnector.executeMutation!(invocation('ads.pause', { objectId: '43' }))
    expect(String(fetch.mock.lastCall![1]?.body)).toBe('status=PAUSED')
    await metaAdsConnector.executeRead!(invocation('reports.insights', { accountId: '123', since: '2026-10-01', until: '2026-10-03', level: 'campaign' }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(JSON.parse(url.searchParams.get('time_range')!)).toEqual({ since: '2026-10-01', until: '2026-10-03' })
    expect(url.searchParams.get('fields')).toContain('spend,actions,action_values')
  })

  it('rejects unsafe budgets/flights and preserves provider auth/rate-limit failures', async () => {
    const fetch = transport()
    await expect(metaAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { spendCap: -1 }))).rejects.toThrow('positive safe integer')
    await expect(metaAdsConnector.executeMutation!(invocation('adSets.createTraffic', { lifetimeBudget: 100, startTime: '2026-10-07', endTime: '2026-10-05' }))).rejects.toThrow('after startTime')
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(metaAdsConnector.executeRead!(invocation('accounts.list'))).rejects.toBeInstanceOf(CredentialsExpired)
    fetch.mockResolvedValueOnce(new Response('{"error":"try later"}', { status: 429, headers: { 'retry-after': '3' } }))
    expect(await metaAdsConnector.executeMutation!(invocation('campaigns.pause', { objectId: '42' }))).toMatchObject({ status: 'rate-limited', retryAfterMs: 3000 })
  })
})
