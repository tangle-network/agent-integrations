import { afterEach, describe, expect, it, vi } from 'vitest'
import { tiktokAdsConnector } from '../src/connectors/adapters/tiktok-ads.js'
import { type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const bundle = { appId: 'app-id', appSecret: 'private-app-secret', accessToken: 'private-token' }
const source: ResolvedDataSource = { id: 'tt', projectId: 'project', publishedAgentId: null, kind: 'tiktok-ads', label: 'Ads', consistencyModel: 'cache',
  scopes: [], metadata: {}, credentials: { kind: 'api-key', apiKey: JSON.stringify(bundle) }, status: 'active' }
const invocation = (capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
function transport(data: unknown = { code: 0, data: { campaign_id: '42' } }, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status }))
}
afterEach(() => vi.restoreAllMocks())

describe('TikTok Ads provider wire contract', () => {
  it('discovers advertisers with private Business app credentials, never supplied by tool arguments', async () => {
    const fetch = transport({ code: 0, data: { list: [{ advertiser_id: '123' }] } })
    await tiktokAdsConnector.executeRead!(invocation('advertisers.list', { appSecret: 'attacker' }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.origin + url.pathname).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/')
    expect(url.searchParams.get('secret')).toBe(bundle.appSecret)
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ 'Access-Token': bundle.accessToken })
    expect(fetch.mock.lastCall![1]?.redirect).toBe('error')
    expect(await tiktokAdsConnector.test(source)).toEqual({ ok: true })
  })

  it('creates disabled total-budget campaign and fixed-flight ad group despite injected status/budget-mode', async () => {
    const fetch = transport()
    await tiktokAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { advertiserId: '123', name: 'Trial', totalBudget: 100, operation_status: 'ENABLE', budget_mode: 'BUDGET_MODE_INFINITE' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ advertiser_id: '123', campaign_name: 'Trial', objective_type: 'TRAFFIC', budget_mode: 'BUDGET_MODE_TOTAL', budget: 100, operation_status: 'DISABLE', budget_optimize_on: false })
    fetch.mockResolvedValue(new Response('{"code":0,"data":{"adgroup_id":"43"}}'))
    await tiktokAdsConnector.executeMutation!(invocation('adgroups.createTraffic', { advertiserId: '123', campaignId: '42', name: 'Audience', totalBudget: 100, startTime: '2026-10-05 00:00:00', endTime: '2026-10-06 00:00:00', locationIds: ['6252001'], bidPrice: 1 }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toMatchObject({ operation_status: 'DISABLE', budget_mode: 'BUDGET_MODE_TOTAL', schedule_type: 'SCHEDULE_START_END', placements: ['PLACEMENT_TIKTOK'], location_ids: ['6252001'], bid_type: 'BID_TYPE_CUSTOM' })
  })

  it('imports video with multipart fields and creates a disabled creative from the resulting asset', async () => {
    const fetch = transport()
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: [{ video_id: 'asset' }] })))
    await tiktokAdsConnector.executeMutation!(invocation('videos.uploadFromUrl', { advertiserId: '123', filename: 'offer.mp4', videoUrl: 'https://example.com/offer.mp4' }))
    const form = fetch.mock.lastCall![1]?.body
    expect(form).toBeInstanceOf(FormData)
    expect((form as FormData).get('upload_type')).toBe('UPLOAD_BY_URL')
    expect((form as FormData).get('video_url')).toBe('https://example.com/offer.mp4')
    fetch.mockResolvedValue(new Response('{"code":0,"data":{"ad_ids":["44"]}}'))
    await tiktokAdsConnector.executeMutation!(invocation('ads.createVideo', { advertiserId: '123', adgroupId: '43', name: 'Ad', adText: 'Meet your operator', videoId: 'asset', identityId: 'identity', identityType: 'TT_USER', landingPageUrl: 'https://example.com/?utm_source=tiktok', callToAction: 'SIGN_UP' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).creatives[0]).toMatchObject({ operation_status: 'DISABLE', ad_format: 'SINGLE_VIDEO', video_id: 'asset', landing_page_url: 'https://example.com/?utm_source=tiktok' })
  })

  it('serializes native filtering/report arrays and changes only delivery status', async () => {
    const fetch = transport()
    await tiktokAdsConnector.executeRead!(invocation('campaigns.list', { advertiserId: '123', objectId: '42', page: 2 }))
    let url = new URL(String(fetch.mock.lastCall![0]))
    expect(JSON.parse(url.searchParams.get('filtering')!)).toEqual({ campaign_ids: ['42'] })
    await tiktokAdsConnector.executeRead!(invocation('reports.integrated', { advertiserId: '123', dataLevel: 'AUCTION_CAMPAIGN', startDate: '2026-10-01', endDate: '2026-10-03', metrics: ['spend', 'conversion'], page: 1 }))
    url = new URL(String(fetch.mock.lastCall![0]))
    expect(JSON.parse(url.searchParams.get('dimensions')!)).toEqual(['campaign_id'])
    expect(JSON.parse(url.searchParams.get('metrics')!)).toEqual(['spend', 'conversion'])
    fetch.mockResolvedValue(new Response('{"code":0,"data":{}}'))
    await tiktokAdsConnector.executeMutation!(invocation('campaigns.pause', { advertiserId: '123', objectId: '42', totalBudget: 9999 }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ advertiser_id: '123', campaign_ids: ['42'], operation_status: 'DISABLE' })
  })

  it('fails closed on native HTTP200 errors and malformed success responses without echoing secrets', async () => {
    const fetch = transport({ code: 40002, message: bundle.appSecret, data: {} })
    await expect(tiktokAdsConnector.executeRead!(invocation('advertisers.list'))).rejects.toThrow('code 40002')
    expect(await tiktokAdsConnector.test(source)).toEqual({ ok: false, reason: 'tiktok-ads: provider rejected request (code 40002)' })
    await expect(tiktokAdsConnector.executeMutation!(invocation('campaigns.pause', { advertiserId: '123', objectId: '42' }))).rejects.toThrow('code 40002')
    fetch.mockResolvedValueOnce(new Response('{"data":{}}'))
    await expect(tiktokAdsConnector.executeRead!(invocation('campaigns.list', { advertiserId: '123' }))).rejects.toThrow('missing numeric code')
    fetch.mockResolvedValueOnce(new Response('{"code":0}'))
    await expect(tiktokAdsConnector.executeMutation!(invocation('campaigns.pause', { advertiserId: '123', objectId: '42' }))).rejects.toThrow('missing data')
  })

  it('rejects incomplete private credentials, unbounded budgets and unsupported asset URLs before requests', async () => {
    const fetch = transport()
    await expect(tiktokAdsConnector.executeRead!({ ...invocation('advertisers.list'), source: { ...source, credentials: { kind: 'api-key', apiKey: 'just-a-token' } } })).rejects.toThrow('JSON bundle')
    await expect(tiktokAdsConnector.executeMutation!(invocation('campaigns.createTraffic', { totalBudget: Infinity }))).rejects.toThrow('positive and finite')
    await expect(tiktokAdsConnector.executeMutation!(invocation('videos.uploadFromUrl', { advertiserId: '123', filename: 'x', videoUrl: 'file:///private' }))).rejects.toThrow('HTTPS URL')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the capability-specific created identity instead of accepting an empty or unrelated receipt', async () => {
    const fetch = transport({ code: 0, data: {} })
    const creates: [string, Record<string, unknown>][] = [
      ['campaigns.createTraffic', { advertiserId: '123', name: 'Trial', totalBudget: 100 }],
      ['adgroups.createTraffic', { advertiserId: '123', campaignId: '42', name: 'Audience', totalBudget: 100, startTime: '2026-10-05 00:00:00', endTime: '2026-10-06 00:00:00', locationIds: ['6252001'], bidPrice: 1 }],
      ['ads.createVideo', { advertiserId: '123', adgroupId: '43', name: 'Ad', adText: 'Meet your operator', videoId: 'asset', identityId: 'identity', identityType: 'TT_USER', landingPageUrl: 'https://example.com', callToAction: 'SIGN_UP' }],
    ]
    for (const [capability, args] of creates) {
      for (const data of [{}, { id: 'unrelated' }, { campaign_id: '', adgroup_id: null, ad_ids: [] }]) {
        fetch.mockResolvedValue(new Response(JSON.stringify({ code: 0, data })))
        await expect(tiktokAdsConnector.executeMutation!(invocation(capability, args))).rejects.toThrow('missing native entity ID')
      }
    }
  })

  it('requires a nonempty video upload receipt with an identity on every item', async () => {
    const fetch = transport()
    for (const data of [[], {}, [{}], [{ video_id: '' }], [{ video_id: 'asset' }, {}]]) {
      fetch.mockResolvedValue(new Response(JSON.stringify({ code: 0, data })))
      await expect(tiktokAdsConnector.executeMutation!(invocation('videos.uploadFromUrl', { advertiserId: '123', filename: 'offer.mp4', videoUrl: 'https://example.com/offer.mp4' }))).rejects.toThrow('missing native entity ID')
    }
  })
})
