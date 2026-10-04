import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMicrosoftAdsConnector } from '../src/connectors/adapters/microsoft-ads.js'
import { CredentialsExpired, type ConnectorInvocation, type ResolvedDataSource } from '../src/connectors/types.js'

const adapter = createMicrosoftAdsConnector({ developerToken: 'private-developer-token' })
const source: ResolvedDataSource = { id: 'microsoft', projectId: 'p', publishedAgentId: null, kind: 'microsoft-ads', label: 'Microsoft', consistencyModel: 'cache', scopes: ['https://ads.microsoft.com/msads.manage'], metadata: {}, credentials: { kind: 'oauth2', accessToken: 'private-access-token' }, status: 'active' }
function inv(capabilityName: string, args: Record<string, unknown> = {}): ConnectorInvocation { return { source, capabilityName, args: { accountId: '123', customerId: '456', ...args }, idempotencyKey: 'once' } }
function transport(data: unknown = { CampaignIds: ['42'], PartialErrors: [] }, status = 200) { return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), { status })) }
afterEach(() => vi.restoreAllMocks())

describe('Microsoft Advertising REST v13 wire contract', () => {
  it('discovers the current user then accessible accounts through Customer Management', async () => {
    const fetch = transport({ User: { Id: '7' }, CustomerRoles: [] })
    await adapter.executeRead!(inv('users.getCurrent'))
    expect(String(fetch.mock.lastCall![0])).toBe('https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({})
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ authorization: 'Bearer private-access-token', DeveloperToken: 'private-developer-token' })
    expect(JSON.stringify(adapter.manifest)).not.toContain('private-developer-token')
    fetch.mockResolvedValue(new Response('{"Accounts":[{"Id":"123","ParentCustomerId":"456","CurrencyCode":"USD"}]}'))
    await adapter.executeRead!(inv('accounts.list', { userId: '7', pageIndex: 2 }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/Accounts/Search')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ Predicates: [{ Field: 'UserId', Operator: 'Equals', Value: '7' }], PageInfo: { Index: 2, Size: 100 } })
  })
  it('creates a paused Search campaign with currency daily budget and capped MaxClicks bidding', async () => {
    const fetch = transport()
    await adapter.executeMutation!(inv('campaigns.createSearch', { name: 'Trial', dailyBudget: 10.25, maxCpc: 1.5, languages: ['English'], isPolitical: false, Status: 'Active', BudgetId: '999' }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/Campaigns')
    expect(fetch.mock.lastCall![1]?.headers).toMatchObject({ CustomerAccountId: '123', CustomerId: '456', 'content-type': 'application/json' })
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ AccountId: '123', Campaigns: [{ Name: 'Trial', CampaignType: 'Search', Status: 'Paused', BudgetType: 'DailyBudgetStandard', DailyBudget: 10.25, BiddingScheme: { Type: 'MaxClicks', MaxCpc: { Amount: 1.5 } }, Languages: ['English'], IsPolitical: false }] })
  })
  it('requires the currency budget before fetching', async () => {
    const fetch = transport()
    await expect(adapter.executeMutation!(inv('campaigns.createSearch', { name: 'Trial', maxCpc: 1, languages: ['English'], isPolitical: false }))).rejects.toThrow('missing required argument: dailyBudget')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('creates a dated paused ad group and native keyword and location criteria', async () => {
    const fetch = transport()
    const startDate = { Year: 2026, Month: 10, Day: 5 }, endDate = { Year: 2026, Month: 10, Day: 8 }
    await adapter.executeMutation!(inv('adGroups.create', { campaignId: '42', name: 'Intent', cpcBid: 1, startDate, endDate }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ CampaignId: '42', AdGroups: [{ Name: 'Intent', Status: 'Paused', Network: 'OwnedAndOperatedOnly', CpcBid: { Amount: 1 }, StartDate: startDate, EndDate: endDate }] })
    await adapter.executeMutation!(inv('keywords.create', { adGroupId: '43', text: 'sales agent', matchType: 'Exact', bid: 0.75 }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ AdGroupId: '43', Keywords: [{ Text: 'sales agent', MatchType: 'Exact', Bid: { Amount: 0.75 }, Status: 'Active' }] })
    await adapter.executeMutation!(inv('campaigns.addLocation', { campaignId: '42', locationId: '190' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ CampaignCriterions: [{ CampaignId: '42', Type: 'BiddableCampaignCriterion', Criterion: { Type: 'LocationCriterion', LocationId: '190' }, CriterionBid: { Type: 'BidMultiplier', Multiplier: 0 } }], CriterionType: 'Location' })
  })
  it('maps text assets into the native responsive search polymorphic asset contract', async () => {
    const fetch = transport({ AdIds: ['44'], PartialErrors: [] })
    const headlines = ['Plan campaigns', 'Know your next step', 'Ship useful work']
    const descriptions = ['Run your sales workflow.', 'Measure outcomes with an operator.']
    await adapter.executeMutation!(inv('ads.createResponsiveSearch', { adGroupId: '43', headlines, descriptions, finalUrls: ['https://example.com/?utm_source=microsoft'], Status: 'Active' }))
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ AdGroupId: '43', Ads: [{ Type: 'ResponsiveSearch', Status: 'Paused', Headlines: headlines.map(Text => ({ Asset: { Type: 'TextAsset', Text } })), Descriptions: descriptions.map(Text => ({ Asset: { Type: 'TextAsset', Text } })), FinalUrls: ['https://example.com/?utm_source=microsoft'] }] })
  })
  it.each([
    ['campaigns', { campaignId: '42' }, { AccountId: '123', Campaigns: [{ Id: '42', Status: 'Active' }] }],
    ['adGroups', { campaignId: '42', adGroupId: '43' }, { CampaignId: '42', AdGroups: [{ Id: '43', Status: 'Active' }] }],
    ['ads', { adGroupId: '43', adId: '44' }, { AdGroupId: '43', Ads: [{ Id: '44', Type: 'ResponsiveSearch', Status: 'Active' }] }],
  ])('activates %s with an identity-and-status-only update', async (resource, args, expected) => {
    const fetch = transport()
    await adapter.executeMutation!(inv(`${resource}.enable`, { ...args, DailyBudget: 999 }))
    expect(fetch.mock.lastCall![1]?.method).toBe('PUT')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual(expected)
    await adapter.executeMutation!(inv(`${resource}.pause`, args))
    expect(String(fetch.mock.lastCall![1]?.body)).toContain('"Status":"Paused"')
  })
  it('submits and polls a daily report on the dedicated reporting service', async () => {
    const fetch = transport({ ReportRequestId: 'r-1' })
    await adapter.executeRead!(inv('reports.requestCampaigns', { startDate: { Year: 2026, Month: 10, Day: 1 }, endDate: { Year: 2026, Month: 10, Day: 2 } }))
    expect(String(fetch.mock.lastCall![0])).toBe('https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toMatchObject({ ReportRequest: { Type: 'CampaignPerformanceReportRequest', Format: 'Csv', ReturnOnlyCompleteData: true, Scope: { AccountIds: ['123'] } } })
    fetch.mockResolvedValue(new Response('{"ReportRequestStatus":{"Status":"Pending"}}'))
    expect((await adapter.executeRead!(inv('reports.get', { reportRequestId: 'r-1' }))).data).toEqual({ ReportRequestStatus: { Status: 'Pending' } })
    expect(String(fetch.mock.lastCall![0])).toBe('https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Poll')
    expect(JSON.parse(String(fetch.mock.lastCall![1]?.body))).toEqual({ ReportRequestId: 'r-1' })
  })
  it('rejects HTTP200 partial errors and redacts both application and OAuth secrets on transport failure', async () => {
    const fetch = transport({ CampaignIds: [null], PartialErrors: [{ Code: 1030, Message: 'private-access-token private-developer-token' }] })
    await expect(adapter.executeMutation!(inv('campaigns.enable', { campaignId: '42' }))).rejects.toThrow('1 provider errors')
    fetch.mockResolvedValue(new Response('account denied private-access-token private-developer-token', { status: 403 }))
    await expect(adapter.executeRead!(inv('users.getCurrent'))).rejects.toThrow('account denied [REDACTED] [REDACTED]')
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(adapter.executeRead!(inv('users.getCurrent'))).rejects.toBeInstanceOf(CredentialsExpired)
  })
})
