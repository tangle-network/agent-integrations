import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { xAdsConnector } from '../src/connectors/adapters/x-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const credentials = { consumerKey: 'app-key', consumerSecret: 'app-secret&private', accessToken: 'user-token', accessTokenSecret: 'user-secret/private' }
const source: ResolvedDataSource = { id: 'ads', projectId: 'workspace', publishedAgentId: null, kind: 'x-ads', label: 'X Ads', scopes: [], metadata: {}, consistencyModel: 'cache', status: 'active', credentials: { kind: 'api-key', apiKey: JSON.stringify(credentials) } }
const invoke = (capabilityName: string, args: Record<string, unknown>): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
function transport(data: unknown = { data: { id: 'new-id' } }, status = 200) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status })) }
afterEach(() => vi.restoreAllMocks())
const encode = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

function verifySignature(url: string, options: RequestInit) {
  const header = new Headers(options.headers).get('authorization')!
  expect(header).toMatch(/^OAuth /)
  const oauth = Object.fromEntries(header.slice(6).split(/,\s*/).map(part => {
    const [key, value] = part.split('=')
    return [decodeURIComponent(key!), decodeURIComponent(value!.replace(/^"|"$/g, ''))]
  }))
  const signature = oauth.oauth_signature!
  delete oauth.oauth_signature
  expect(oauth).toMatchObject({ oauth_consumer_key: credentials.consumerKey, oauth_token: credentials.accessToken, oauth_signature_method: 'HMAC-SHA1' })
  const target = new URL(url)
  const pairs = [...target.searchParams, ...new URLSearchParams(String(options.body ?? '')), ...Object.entries(oauth)]
    .map(([k, v]) => [encode(k), encode(v)]).sort(([ak, av], [bk, bv]) => ak! < bk! ? -1 : ak! > bk! ? 1 : av! < bv! ? -1 : av! > bv! ? 1 : 0)
  const normalized = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const expected = createHmac('sha1', `${encode(credentials.consumerSecret)}&${encode(credentials.accessTokenSecret)}`)
    .update([options.method, encode(target.origin + target.pathname), encode(normalized)].join('&')).digest('base64')
  expect(signature).toBe(expected)
  expect(header).not.toContain(credentials.consumerSecret)
  expect(header).not.toContain(credentials.accessTokenSecret)
}

describe('X Ads provider contract', () => {
  it('discovers accounts with signed user-context OAuth1 and preserves pagination', async () => {
    const fetch = transport({ data: [{ id: 'abc', timezone: 'UTC' }], next_cursor: 'next' })
    const result = await xAdsConnector.executeRead!(invoke('accounts.list', { cursor: 'page+2', count: 10 }))
    expect(result.data).toMatchObject({ next_cursor: 'next' })
    expect(String(fetch.mock.lastCall![0])).toContain('https://ads-api.x.com/12/accounts?')
    verifySignature(String(fetch.mock.lastCall![0]), fetch.mock.lastCall![1]!)
  })
  it('signs the actual form bytes and enforces paused, total-budget campaign creation', async () => {
    const fetch = transport()
    await xAdsConnector.executeMutation(invoke('campaigns.create', { accountId: 'abc', name: "R&D + (growth)", fundingInstrumentId: 'fund', totalBudgetMicros: '100000000', dailyBudgetMicros: '20000000', entity_status: 'ACTIVE' }))
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({ name: 'R&D + (growth)', funding_instrument_id: 'fund', total_budget_amount_local_micro: '100000000', daily_budget_amount_local_micro: '20000000', budget_optimization: 'LINE_ITEM', entity_status: 'PAUSED' })
    verifySignature(String(fetch.mock.lastCall![0]), fetch.mock.lastCall![1]!)
  })
  it('creates a scheduled traffic line item and attaches a post through the native endpoint', async () => {
    const fetch = transport()
    await xAdsConnector.executeMutation(invoke('lineItems.createTraffic', { accountId: 'abc', campaignId: 'camp', name: 'Traffic', startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-07T00:00:00Z', totalBudgetMicros: '100000000', bidMicros: '1000000' }))
    const body = Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))
    expect(body).toMatchObject({ objective: 'WEBSITE_CLICKS', goal: 'LINK_CLICKS', bid_strategy: 'MAX', entity_status: 'PAUSED', total_budget_amount_local_micro: '100000000', end_time: '2026-10-07T00:00:00Z' })
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'promoted123' }] })))
    await xAdsConnector.executeMutation(invoke('ads.promotePost', { accountId: 'abc', lineItemId: 'line', tweetId: '123456' }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://ads-api.x.com/12/accounts/abc/promoted_tweets')
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({ line_item_id: 'line', tweet_ids: '123456' })
  })
  it('creates promoted-only posts with required advertiser identity and native media keys', async () => {
    const fetch = transport()
    await xAdsConnector.executeMutation(invoke('posts.createPromotedOnly', { accountId: 'abc', advertiserUserId: '123', text: 'Run GTM', mediaKeys: '3_456', nullcast: false }))
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({ as_user_id: '123', text: 'Run GTM', media_keys: '3_456', nullcast: 'true' })
    await expect(xAdsConnector.executeMutation(invoke('posts.createPromotedOnly', { accountId: 'abc', text: 'Run GTM' }))).rejects.toThrow('advertiserUserId')
  })
  it('rejects invalid monetary bounds, missing caps and reversed schedules before sending', async () => {
    const fetch = transport()
    await expect(xAdsConnector.executeMutation(invoke('campaigns.create', { accountId: 'abc', name: 'Test', fundingInstrumentId: 'fund', dailyBudgetMicros: '1' }))).rejects.toThrow('totalBudgetMicros')
    await expect(xAdsConnector.executeMutation(invoke('campaigns.enable', { accountId: 'abc', campaignId: 'camp', totalBudgetMicros: '1', dailyBudgetMicros: '2' }))).rejects.toThrow('daily budget exceeds')
    await expect(xAdsConnector.executeMutation(invoke('lineItems.createTraffic', { startTime: '2026-10-07T00:00:00Z', endTime: '2026-10-05T00:00:00Z' }))).rejects.toThrow('endTime')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('launches with the approved total and pauses without an unrestricted update body', async () => {
    const fetch = transport()
    await xAdsConnector.executeMutation(invoke('campaigns.enable', { accountId: 'abc', campaignId: 'camp', totalBudgetMicros: '100000000', dailyBudgetMicros: '20000000', funding_instrument_id: 'injected' }))
    expect(Object.fromEntries(new URLSearchParams(String(fetch.mock.lastCall![1]?.body)))).toEqual({ entity_status: 'ACTIVE', total_budget_amount_local_micro: '100000000', daily_budget_amount_local_micro: '20000000' })
    await xAdsConnector.executeMutation(invoke('campaigns.pause', { accountId: 'abc', campaignId: 'camp' }))
    expect(fetch.mock.lastCall![1]?.method).toBe('PUT')
    expect(String(fetch.mock.lastCall![1]?.body)).toBe('entity_status=PAUSED')
  })
  it('preserves advertiser denial, expiration and throttling as failures', async () => {
    const fetch = transport({ errors: [{ message: 'Ads access not approved app-secret&private' }] }, 403)
    await expect(xAdsConnector.executeRead!(invoke('accounts.list', {}))).rejects.toThrow('Ads access not approved [REDACTED]')
    fetch.mockResolvedValueOnce(new Response('{}', { status: 401 }))
    await expect(xAdsConnector.executeRead!(invoke('accounts.list', {}))).rejects.toBeInstanceOf(CredentialsExpired)
    fetch.mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
    expect(await xAdsConnector.executeMutation(invoke('campaigns.pause', { accountId: 'abc', campaignId: 'camp' }))).toMatchObject({ status: 'rate-limited', retryAfterMs: 2000 })
  })
  it('rejects native errors and missing receipts returned with HTTP success', async () => {
    const fetch = transport({ errors: [{ code: 'INVALID', message: 'provider failure' }] })
    await expect(xAdsConnector.executeMutation(invoke('campaigns.pause', { accountId: 'abc', campaignId: 'camp' }))).rejects.toThrow('native mutation receipt')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
    await expect(xAdsConnector.executeMutation(invoke('ads.promotePost', { accountId: 'abc', lineItemId: 'line', tweetId: '123456' }))).rejects.toThrow('native mutation receipt')
  })
  it('reports spend through the analytics endpoint, not an organic publishing action', async () => {
    const fetch = transport({ data: [{ id: 'camp', id_data: [{ metrics: { billed_charge_local_micro: [1000000] } }] }] })
    await xAdsConnector.executeRead!(invoke('reports.stats', { accountId: 'abc', entity: 'CAMPAIGN', entityIds: 'camp', startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-06T00:00:00Z', granularity: 'DAY' }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.pathname).toBe('/12/stats/accounts/abc')
    expect(url.searchParams.get('metric_groups')).toBe('ENGAGEMENT,BILLING,WEB_CONVERSION')
    verifySignature(String(fetch.mock.lastCall![0]), fetch.mock.lastCall![1]!)
  })
})
