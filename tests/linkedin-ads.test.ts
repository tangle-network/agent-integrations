import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkedinAdsConnector } from '../src/connectors/adapters/linkedin-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = { id: 'ads', projectId: 'workspace', publishedAgentId: null, kind: 'linkedin-ads', label: 'LinkedIn Ads', scopes: ['rw_ads', 'r_ads_reporting'], metadata: {}, consistencyModel: 'cache', status: 'active', credentials: { kind: 'oauth2', accessToken: 'private-linkedin-token' } }
const invoke = (capabilityName: string, args: Record<string, unknown>): ConnectorInvocation => ({ source, capabilityName, args, idempotencyKey: 'one-request' })
function transport(data: unknown = {}, status = 200, headers: Record<string, string> = {}) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(status === 204 ? null : JSON.stringify(data), { status, headers })) }
afterEach(() => vi.restoreAllMocks())
const campaign = { accountId: '123', groupId: '456', associatedEntity: 'urn:li:organization:1234', name: 'Trial', totalBudget: '100.00', currencyCode: 'USD', bidAmount: '2.00', startTime: 1791158400000, endTime: 1791331200000,
  targetingCriteria: { include: { and: [{ or: { locations: ['urn:li:geo:103644278'] } }, { or: { interfaceLocales: ['urn:li:locale:en_US'] } }] } }, localeCountry: 'US', localeLanguage: 'en', politicalIntent: 'NOT_POLITICAL' }

describe('LinkedIn Ads provider contract', () => {
  it('discovers accounts using Marketing API scopes, version and native pagination', async () => {
    const fetch = transport({ elements: [{ id: 123 }], metadata: { nextPageToken: 'next' } })
    expect((await linkedinAdsConnector.executeRead!(invoke('accounts.list', { pageSize: 25, pageToken: 'previous' }))).data).toMatchObject({ metadata: { nextPageToken: 'next' } })
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.pathname).toBe('/rest/adAccounts')
    expect(url.searchParams.get('q')).toBe('search')
    expect(url.searchParams.get('pageToken')).toBe('previous')
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get('LinkedIn-Version')).toBe('202609')
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get('authorization')).toBe('Bearer private-linkedin-token')
  })
  it('captures header-only create IDs and builds a paused lifetime budget with a fixed schedule', async () => {
    const fetch = transport({}, 201, { 'x-restli-id': '789' })
    const result = await linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, status: 'ACTIVE', dailyBudget: { amount: '9999' } }))
    expect(result).toMatchObject({ status: 'committed', data: { id: '789' } })
    const body = JSON.parse(String(fetch.mock.lastCall![1]?.body))
    expect(body).toMatchObject({ status: 'PAUSED', pacingStrategy: 'LIFETIME', totalBudget: { amount: '100.00', currencyCode: 'USD' }, runSchedule: { start: campaign.startTime, end: campaign.endTime }, campaignGroup: 'urn:li:sponsoredCampaignGroup:456', targetingCriteria: { include: { and: [{ or: { 'urn:li:adTargetingFacet:locations': ['urn:li:geo:103644278'] } }, { or: { 'urn:li:adTargetingFacet:interfaceLocales': ['urn:li:locale:en_US'] } }] } }, audienceExpansionEnabled: false, offsiteDeliveryEnabled: false })
    expect(body).not.toHaveProperty('dailyBudget')
    expect(body.account).toBe('urn:li:sponsoredAccount:123')
    expect(body.associatedEntity).toBe(campaign.associatedEntity)
  })
  it('encodes exclusions and rejects unknown facets before sending a campaign', async () => {
    const fetch = transport({}, 201, { 'x-restli-id': '789' })
    await linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, targetingCriteria: { ...campaign.targetingCriteria, exclude: { or: { employers: ['urn:li:organization:999'] } } } }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).targetingCriteria.exclude).toEqual({ or: { 'urn:li:adTargetingFacet:employers': ['urn:li:organization:999'] } })
    fetch.mockClear()
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, targetingCriteria: { include: { and: [{ or: { unknown: ['urn:li:geo:123'] } }] } } }))).rejects.toThrow('unknown targeting facet')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('creates a draft group with its own cumulative spending ceiling', async () => {
    const fetch = transport({}, 201, { 'x-restli-id': '456' })
    await linkedinAdsConnector.executeMutation(invoke('campaignGroups.create', campaign))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ account: 'urn:li:sponsoredAccount:123', name: 'Trial', status: 'DRAFT', totalBudget: { amount: '100.00', currencyCode: 'USD' }, runSchedule: { start: campaign.startTime, end: campaign.endTime } })
  })
  it('rejects unbounded or invalid campaign inputs before a provider mutation', async () => {
    const fetch = transport()
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, totalBudget: undefined }))).rejects.toThrow('totalBudget')
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, totalBudget: '-10' }))).rejects.toThrow('positive decimal')
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, endTime: campaign.startTime - 1 }))).rejects.toThrow('endTime')
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', { ...campaign, associatedEntity: undefined }))).rejects.toThrow('associatedEntity')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sponsors existing content and changes serving status using native partial updates', async () => {
    const fetch = transport({}, 201, { 'x-restli-id': 'urn:li:sponsoredCreative:789' })
    await linkedinAdsConnector.executeMutation(invoke('creatives.createFromPost', { accountId: '123', campaignId: '456', postUrn: 'urn:li:share:789', name: 'Trial ad' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ campaign: 'urn:li:sponsoredCampaign:456', content: { reference: 'urn:li:share:789' }, name: 'Trial ad', intendedStatus: 'PAUSED' })
    fetch.mockImplementation(async () => new Response(null, { status: 204 }))
    await linkedinAdsConnector.executeMutation(invoke('creatives.enable', { accountId: '123', creativeUrn: 'urn:li:sponsoredCreative:789' }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://api.linkedin.com/rest/adAccounts/123/creatives/urn%3Ali%3AsponsoredCreative%3A789')
    expect(new Headers(fetch.mock.lastCall![1]?.headers).get('X-RestLi-Method')).toBe('PARTIAL_UPDATE')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ patch: { $set: { intendedStatus: 'ACTIVE' } } })
    await linkedinAdsConnector.executeMutation(invoke('campaigns.pause', { accountId: '123', campaignId: '456' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ patch: { $set: { status: 'PAUSED' } } })
  })
  it('uses current targeting discovery and reads currency-valued campaign analytics', async () => {
    const fetch = transport({ elements: [] })
    await linkedinAdsConnector.executeRead!(invoke('targeting.search', { facet: 'locations', query: 'California' }))
    expect(new URL(String(fetch.mock.lastCall![0])).searchParams.get('facet')).toBe('urn:li:adTargetingFacet:locations')
    await linkedinAdsConnector.executeRead!(invoke('reports.analytics', { accountId: '123', startYear: 2026, startMonth: 10, startDay: 1, endYear: 2026, endMonth: 10, endDay: 3 }))
    const url = new URL(String(fetch.mock.lastCall![0]))
    expect(url.pathname).toBe('/rest/adAnalytics')
    expect(url.searchParams.get('accounts')).toBe('List(urn:li:sponsoredAccount:123)')
    expect(url.searchParams.get('dateRange')).toBe('(start:(year:2026,month:10,day:1),end:(year:2026,month:10,day:3))')
    expect(url.searchParams.get('fields')).toContain('costInLocalCurrency')
  })
  it('rejects missing create receipts and nonempty status-error responses instead of reporting committed', async () => {
    const fetch = transport({}, 201)
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.createSponsored', campaign))).rejects.toThrow('x-restli-id')
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ serviceErrorCode: 100, message: 'denied' })))
    await expect(linkedinAdsConnector.executeMutation(invoke('campaigns.pause', { accountId: '123', campaignId: '456' }))).rejects.toThrow('unexpected mutation receipt')
  })
  it('preserves Marketing API approval denial and expired OAuth without exposing the token', async () => {
    const fetch = transport({ message: 'Not approved private-linkedin-token' }, 403)
    await expect(linkedinAdsConnector.executeRead!(invoke('accounts.list', {}))).rejects.toThrow('Not approved [REDACTED]')
    fetch.mockImplementation(async () => new Response('{}', { status: 401 }))
    await expect(linkedinAdsConnector.executeRead!(invoke('accounts.list', {}))).rejects.toBeInstanceOf(CredentialsExpired)
    expect(linkedinAdsConnector.manifest.capabilities.filter(c => c.class === 'mutation').every(c => c.cas === 'none' && c.externalEffect)).toBe(true)
  })
})
