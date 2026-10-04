import { afterEach, describe, expect, it, vi } from 'vitest'
import { redditAdsConnector } from '../src/connectors/adapters/reddit-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = { id: 'ads', projectId: 'workspace', publishedAgentId: null, kind: 'reddit-ads', label: 'Reddit Ads', scopes: ['adsread', 'adsedit'], metadata: {}, consistencyModel: 'cache', status: 'active', credentials: { kind: 'oauth2', accessToken: 'private-reddit-token' } }
const invoke = (capabilityName: string, args: Record<string, unknown>): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
function transport(data: unknown = { data: { id: 'native-id' } }, status = 200) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status })) }
afterEach(() => vi.restoreAllMocks())
const campaign = { accountId: 'a2_account', name: 'Trial', totalBudgetMicros: 100000000, startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-07T00:00:00Z', pixelId: 'pixel1' }

describe('Reddit Ads provider contract', () => {
  it('discovers advertiser businesses and accounts with separate ads OAuth and v3 pagination', async () => {
    const fetch = transport({ data: [{ id: 'business1' }], pagination: { next_url: 'provider-owned-next' } })
    expect((await redditAdsConnector.executeRead!(invoke('businesses.list', {}))).data).toHaveProperty('data')
    expect(String(fetch.mock.lastCall![0])).toBe('https://ads-api.reddit.com/api/v3/me/businesses')
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get('authorization')).toBe('Bearer private-reddit-token')
    await redditAdsConnector.executeRead!(invoke('accounts.list', { businessId: 'business1', pageToken: 'next', pageSize: 50 }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.pathname).toBe('/api/v3/businesses/business1/ad_accounts')
    expect(url.searchParams.get('page.token')).toBe('next')
    expect(url.searchParams.get('page.size')).toBe('50')
    expect(redditAdsConnector.manifest.auth).toMatchObject({ scopes: ['adsread', 'adsedit'], pkce: 'unsupported', tokenClientAuthMethod: 'client_secret_basic', clientIdEnv: 'REDDIT_ADS_OAUTH_CLIENT_ID' })
  })
  it('creates paused CBO traffic with a lifetime budget and required pixel', async () => {
    const fetch = transport()
    await redditAdsConnector.executeMutation(invoke('campaigns.createTraffic', { ...campaign, configured_status: 'ACTIVE', goal_type: 'DAILY_SPEND' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ data: { name: 'Trial', configured_status: 'PAUSED', objective: 'CLICKS', is_campaign_budget_optimization: true, goal_type: 'LIFETIME_SPEND', goal_value: 100000000, start_time: campaign.startTime, end_time: campaign.endTime, bid_strategy: 'BIDLESS', bid_type: 'CPC', conversion_pixel_id: 'pixel1' } })
  })
  it('preserves null bid inheritance and explicit geography/community targeting', async () => {
    const fetch = transport()
    await redditAdsConnector.executeMutation(invoke('adGroups.createTraffic', { ...campaign, campaignId: 'campaign1', geolocations: ['US'], communities: ['SaaS'], excludedCommunities: ['politics'] }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).data).toMatchObject({ campaign_id: 'campaign1', bid_strategy: null, bid_value: null, configured_status: 'PAUSED', conversion_pixel_id: 'pixel1', targeting: { geolocations: ['US'], communities: ['SaaS'], excluded_communities: ['politics'], expand_targeting: false } })
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).data).not.toHaveProperty('goal_value')
  })
  it('rejects unsafe amounts, missing pixel and reversed schedules before sending', async () => {
    const fetch = transport()
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.createTraffic', { ...campaign, totalBudgetMicros: Number.MAX_SAFE_INTEGER + 1 }))).rejects.toThrow('safe integer')
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.createTraffic', { ...campaign, pixelId: undefined }))).rejects.toThrow('pixelId')
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.createTraffic', { ...campaign, endTime: campaign.startTime }))).rejects.toThrow('endTime')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('submits an image job, reads its state, then creates a paused ad from the native post', async () => {
    const fetch = transport({ data: { id: 'job1', status: 'PROCESSING' } })
    const submitted = await redditAdsConnector.executeMutation(invoke('posts.createImage', { profileId: 'profile1', headline: 'GTM that executes', destinationUrl: 'https://example.com/?utm_source=reddit', imageUrl: 'https://example.com/ad.png', thumbnailUrl: 'https://example.com/thumb.png', allowComments: true }))
    expect(submitted).toMatchObject({ status: 'committed', data: { data: { status: 'PROCESSING' } } })
    expect(String(fetch.mock.lastCall![0])).toBe('https://ads-api.reddit.com/api/v3/profiles/profile1/structured_posts/jobs')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).data.creative).toMatchObject({ type: 'IMAGE', image: { media: { type: 'URL', url: 'https://example.com/ad.png' } }, destination: { type: 'URL', url: 'https://example.com/?utm_source=reddit' } })
    fetch.mockImplementation(async () => new Response(JSON.stringify({ data: { id: 'job1', status: 'SUCCESS', post_id: 't3_post' } })))
    expect((await redditAdsConnector.executeRead!(invoke('posts.getJob', { jobId: 'job1' }))).data).toMatchObject({ data: { status: 'SUCCESS' } })
    await redditAdsConnector.executeMutation(invoke('ads.create', { accountId: 'a2_account', adGroupId: 'group1', name: 'Trial ad', postId: 't3_post', clickUrl: 'https://example.com/?utm_source=reddit' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ data: { ad_group_id: 'group1', name: 'Trial ad', post_id: 't3_post', click_url: 'https://example.com/?utm_source=reddit', configured_status: 'PAUSED' } })
  })
  it('uses native PATCH for launch/pause and POST as read-only reporting', async () => {
    const fetch = transport()
    await redditAdsConnector.executeMutation(invoke('campaigns.enable', { id: 'campaign1', goal_value: 999999999 }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://ads-api.reddit.com/api/v3/campaigns/campaign1')
    expect(fetch.mock.lastCall![1]?.method).toBe('PATCH')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ data: { configured_status: 'ACTIVE' } })
    await redditAdsConnector.executeMutation(invoke('campaigns.pause', { id: 'campaign1' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ data: { configured_status: 'PAUSED' } })
    await redditAdsConnector.executeRead!(invoke('reports.get', { accountId: 'a2_account', startTime: campaign.startTime, endTime: campaign.endTime, fields: ['SPEND', 'CLICKS', 'CONVERSION_SIGN_UP_CLICKS'] }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://ads-api.reddit.com/api/v3/ad_accounts/a2_account/reports')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ data: { starts_at: campaign.startTime, ends_at: campaign.endTime, fields: ['SPEND', 'CLICKS', 'CONVERSION_SIGN_UP_CLICKS'], breakdowns: ['CAMPAIGN_ID', 'DATE'] } })
  })
  it('rejects malformed mutation receipts and immediate failed creative jobs', async () => {
    const fetch = transport({ error: { message: 'denied' } })
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.pause', { id: 'campaign1' }))).rejects.toThrow('native mutation receipt')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.pause', { id: 'campaign1' }))).rejects.toThrow('native mutation receipt')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'job1', status: 'CLIENT_ERROR' } })))
    await expect(redditAdsConnector.executeMutation(invoke('posts.createText', { profileId: 'profile1', headline: 'Offer', body: 'Details', allowComments: false }))).rejects.toThrow('post creation job failed')
  })
  it('preserves native denied, expired and throttled outcomes without exposing credentials', async () => {
    const fetch = transport({ error: { message: 'adsedit missing private-reddit-token' } }, 403)
    await expect(redditAdsConnector.executeMutation(invoke('campaigns.pause', { id: 'campaign1' }))).rejects.toThrow('adsedit missing [REDACTED]')
    fetch.mockImplementation(async () => new Response('{}', { status: 401 }))
    await expect(redditAdsConnector.executeRead!(invoke('businesses.list', {}))).rejects.toBeInstanceOf(CredentialsExpired)
    fetch.mockImplementation(async () => new Response('{}', { status: 429, headers: { 'retry-after': '3' } }))
    expect(await redditAdsConnector.executeMutation(invoke('campaigns.pause', { id: 'campaign1' }))).toMatchObject({ status: 'rate-limited', retryAfterMs: 3000 })
  })
})
