import { afterEach, describe, expect, it, vi } from 'vitest'
import { snapchatAdsConnector } from '../src/connectors/adapters/snapchat-ads.js'
import { type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const objectId = '12345678-1234-1234-1234-123456789abc'
const source: ResolvedDataSource = { id: 'snap', projectId: 'project', publishedAgentId: null, kind: 'snapchat-ads', label: 'Ads', consistencyModel: 'cache',
  scopes: ['snapchat-marketing-api'], metadata: {}, credentials: { kind: 'oauth2', accessToken: 'private-token' }, status: 'active' }
const invocation = (capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
const receipt = (resource: string) => ({ request_status: 'SUCCESS', [resource]: [{ sub_request_status: 'SUCCESS', [resource === 'media' ? 'media' : resource.slice(0, -1)]: { id: objectId } }] })
function transport(data: unknown = { request_status: 'SUCCESS', campaigns: [{ sub_request_status: 'SUCCESS', campaign: { id: objectId } }] }, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status }))
}
afterEach(() => vi.restoreAllMocks())

describe('Snapchat Ads provider wire contract', () => {
  it('discovers organization ad accounts with OAuth and retains native paging', async () => {
    const fetch = transport({ request_status: 'SUCCESS', organizations: [], paging: { next_link: 'next' } })
    expect((await snapchatAdsConnector.executeRead!(invocation('accounts.list', { cursor: 'prior' }))).data).toMatchObject({ paging: { next_link: 'next' } })
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.origin + url.pathname).toBe('https://adsapi.snapchat.com/v1/me/organizations')
    expect(url.searchParams.get('with_ad_accounts')).toBe('true')
    expect(url.searchParams.get('cursor')).toBe('prior')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ authorization: 'Bearer private-token' })
  })

  it('requires lifetime campaign and ad-squad caps plus fixed flights, creating only paused objects', async () => {
    const fetch = transport()
    const flight = { startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-07T00:00:00Z' }
    await snapchatAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { accountId: objectId, name: 'Trial', lifetimeSpendCapMicro: 100000000, ...flight, status: 'ACTIVE' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).campaigns[0]).toMatchObject({ status: 'PAUSED', lifetime_spend_cap_micro: 100000000, objective_v2_properties: { objective_v2_type: 'TRAFFIC' } })
    fetch.mockResolvedValue(new Response(JSON.stringify(receipt('adsquads'))))
    await snapchatAdsConnector.executeMutation!(invocation('adsquads.createTraffic', { campaignId: objectId, name: 'Audience', lifetimeBudgetMicro: 100000000, bidMicro: 1000000, ...flight, countries: ['us'] }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).adsquads[0]).toMatchObject({ status: 'PAUSED', lifetime_budget_micro: 100000000, delivery_constraint: 'LIFETIME_BUDGET', targeting: { geos: [{ country_code: 'us' }] } })
  })

  it('PATCHes status only, so a pause cannot reset budgets or targeting through PUT defaults', async () => {
    const fetch = transport()
    await snapchatAdsConnector.executeMutation!(invocation('campaigns.enable', { accountId: objectId, objectId, statusPatch: [{ op: 'remove', path: '/lifetime_spend_cap_micro' }] }))
    expect(fetch.mock.lastCall![1]?.method).toBe('PATCH')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ 'content-type': 'application/json-patch+json' })
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ op: 'replace', path: '/status', value: 'ACTIVE' }])
    fetch.mockResolvedValue(new Response(JSON.stringify(receipt('ads'))))
    await snapchatAdsConnector.executeMutation!(invocation('ads.pause', { adSquadId: objectId, objectId }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual([{ op: 'replace', path: '/status', value: 'PAUSED' }])
  })

  it('uploads bounded bytes as multipart and links website creative to the correct ad type', async () => {
    const fetch = transport(receipt('media'))
    expect((await snapchatAdsConnector.executeMutation!(invocation('media.create', { accountId: objectId, name: 'Offer', type: 'IMAGE' }))).status).toBe('committed')
    fetch.mockResolvedValue(new Response(JSON.stringify({ request_status: 'success', result: { id: objectId, media_status: 'READY' } })))
    await snapchatAdsConnector.executeMutation!(invocation('media.upload', { mediaId: objectId, fileBase64: 'YWJj', filename: 'offer.png', mimeType: 'image/png' }))
    expect(fetch.mock.lastCall![1]?.body).toBeInstanceOf(FormData)
    const file = (fetch.mock.lastCall![1]?.body as FormData).get('file') as File
    expect(await file.text()).toBe('abc')
    expect(fetch.mock.lastCall![1]?.headers).not.toHaveProperty('content-type')
    fetch.mockResolvedValue(new Response(JSON.stringify(receipt('creatives'))))
    await snapchatAdsConnector.executeMutation!(invocation('creatives.createWebsite', { accountId: objectId, name: 'Offer', mediaId: objectId, profileId: objectId, headline: 'Run your pipeline', url: 'https://example.com/?utm_source=snapchat', callToAction: 'SIGN_UP' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).creatives[0]).toMatchObject({ type: 'WEB_VIEW', profile_properties: { profile_id: objectId }, web_view_properties: { url: 'https://example.com/?utm_source=snapchat' } })
    fetch.mockResolvedValue(new Response(JSON.stringify(receipt('ads'))))
    await snapchatAdsConnector.executeMutation!(invocation('ads.create', { adSquadId: objectId, creativeId: objectId, name: 'Ad' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).ads[0]).toMatchObject({ status: 'PAUSED', type: 'REMOTE_WEBPAGE' })
  })

  it('fails closed on HTTP200 request/sub-request failures and malformed envelopes', async () => {
    const fetch = transport({ request_status: 'SUCCESS', ads: [{ sub_request_status: 'ERROR', sub_request_error_reason: 'private-token' }] })
    await expect(snapchatAdsConnector.executeMutation!(invocation('ads.pause', { adSquadId: objectId, objectId }))).rejects.toThrow('provider rejected a sub-request')
    expect(await snapchatAdsConnector.test(source)).toEqual({ ok: false, reason: 'snapchat-ads: provider rejected a sub-request; inspect native status before retrying' })
    fetch.mockResolvedValueOnce(new Response('{"request_status":"ERROR"}'))
    await expect(snapchatAdsConnector.executeRead!(invocation('accounts.list'))).rejects.toThrow('provider rejected request')
    fetch.mockResolvedValueOnce(new Response('{}'))
    await expect(snapchatAdsConnector.executeRead!(invocation('accounts.list'))).rejects.toThrow('missing request_status')
  })

  it('rejects invalid upload/budget before calling and preserves native throttling', async () => {
    const fetch = transport()
    await expect(snapchatAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { lifetimeSpendCapMicro: 0 }))).rejects.toThrow('positive safe integer')
    await expect(snapchatAdsConnector.executeMutation!(invocation('media.upload', { mediaId: objectId, fileBase64: 'not base64', filename: 'x.png', mimeType: 'image/png' }))).rejects.toThrow('canonical base64')
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockResolvedValueOnce(new Response('{}', { status: 429 }))
    expect(await snapchatAdsConnector.executeMutation!(invocation('campaigns.pause', { accountId: objectId, objectId }))).toMatchObject({ status: 'rate-limited' })
  })

  it('requires the expected successful sub-request and entity identity for creates and status writes', async () => {
    const fetch = transport()
    const flight = { startTime: '2026-10-05T00:00:00Z', endTime: '2026-10-07T00:00:00Z' }
    const mutations: [string, Record<string, unknown>][] = [
      ['campaigns.createTraffic', { accountId: objectId, name: 'Trial', lifetimeSpendCapMicro: 100000000, ...flight }],
      ['adsquads.createTraffic', { campaignId: objectId, name: 'Audience', lifetimeBudgetMicro: 100000000, bidMicro: 1000000, ...flight, countries: ['us'] }],
      ['media.create', { accountId: objectId, name: 'Offer', type: 'IMAGE' }],
      ['creatives.createWebsite', { accountId: objectId, name: 'Offer', mediaId: objectId, profileId: objectId, headline: 'Offer', url: 'https://example.com', callToAction: 'SIGN_UP' }],
      ['ads.create', { adSquadId: objectId, creativeId: objectId, name: 'Ad' }],
      ['campaigns.pause', { accountId: objectId, objectId }],
    ]
    for (const [capability, args] of mutations) {
      const resource = capability.split('.')[0]!
      const entity = resource === 'media' ? 'media' : resource.slice(0, -1)
      for (const body of [{}, { [resource]: [] }, { [resource]: [{ [entity]: { id: objectId } }] }, { [resource]: [{ sub_request_status: 'SUCCESS', [entity]: {} }] }]) {
        fetch.mockResolvedValue(new Response(JSON.stringify({ request_status: 'SUCCESS', ...body })))
        await expect(snapchatAdsConnector.executeMutation!(invocation(capability, args))).rejects.toThrow('reconcile provider state')
      }
    }
  })

  it('requires result.id from the native upload response', async () => {
    const fetch = transport()
    for (const body of [{}, { result: {} }, { result: { id: '' } }, { media: [] }]) {
      fetch.mockResolvedValue(new Response(JSON.stringify({ request_status: 'SUCCESS', ...body })))
      await expect(snapchatAdsConnector.executeMutation!(invocation('media.upload', { mediaId: objectId, fileBase64: 'YWJj', filename: 'offer.png', mimeType: 'image/png' }))).rejects.toThrow('missing native entity ID')
    }
  })
})
