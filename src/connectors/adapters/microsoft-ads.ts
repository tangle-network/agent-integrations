import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import type { ConnectorAdapter } from '../types.js'

const scope = 'https://ads.microsoft.com/msads.manage'
const text = { type: 'string', minLength: 1 }
const id = { ...text, pattern: '^[0-9]+$' }
const money = { type: 'number', exclusiveMinimum: 0, description: 'Amount in the advertising account currency, not micros or cents.' }
const date = { type: 'object', properties: { Year: { type: 'integer', minimum: 2020 }, Month: { type: 'integer', minimum: 1, maximum: 12 }, Day: { type: 'integer', minimum: 1, maximum: 31 } }, required: ['Year', 'Month', 'Day'], additionalProperties: false }
const accountHeaders = { CustomerAccountId: '{accountId}', CustomerId: '{customerId}' }
const customerService = 'https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13'
const reportService = 'https://reporting.api.bingads.microsoft.com/Reporting/v13'
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: { accountId: id, customerId: id, ...properties }, required: ['accountId', 'customerId', ...required], additionalProperties: false }
}
function write(name: string, description: string, path: string, properties: Record<string, unknown>, required: string[], body: Record<string, unknown>, method: 'POST' | 'PUT' = 'POST'): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: [scope], parameters: parameters(properties, required), request: { method, path, headers: accountHeaders, body } }
}

export interface MicrosoftAdsOptions { developerToken: string }

export function createMicrosoftAdsConnector(options: MicrosoftAdsOptions): ConnectorAdapter {
  if (!options.developerToken?.trim()) throw new Error('Microsoft Ads requires an approved developerToken')
  const rest = declarativeRestConnector({
    kind: 'microsoft-ads', displayName: 'Microsoft Advertising', description: 'Microsoft Advertising REST v13 Search campaigns, keyword and location targeting, responsive search ads and asynchronous reports.',
    auth: { kind: 'oauth2', authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scopes: [scope, 'offline_access'], clientIdEnv: 'MICROSOFT_ADS_CLIENT_ID', clientSecretEnv: 'MICROSOFT_ADS_CLIENT_SECRET' },
    category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://campaign.api.bingads.microsoft.com/CampaignManagement/v13', credentialsExpiredStatuses: [401], credentialHeaders: { DeveloperToken: options.developerToken },
    test: { method: 'POST', path: `${customerService}/User/Query`, body: {} },
    capabilities: [
      { name: 'users.getCurrent', class: 'read', requiredScopes: [scope], description: 'Get the authenticated user ID and customer roles before account discovery.', parameters: { type: 'object', properties: {}, additionalProperties: false }, request: { method: 'POST', path: `${customerService}/User/Query`, body: {} } },
      {
        name: 'accounts.list', class: 'read', requiredScopes: [scope], description: 'Search accounts accessible to the user returned by users.getCurrent, including currency, timezone, status and parent customer ID. Page index is zero-based.',
        parameters: { type: 'object', properties: { userId: id, pageIndex: { type: 'integer', minimum: 0 } }, required: ['userId', 'pageIndex'], additionalProperties: false },
        request: { method: 'POST', path: `${customerService}/Accounts/Search`, body: { Predicates: [{ Field: 'UserId', Operator: 'Equals', Value: '{userId}' }], PageInfo: { Index: '{pageIndex}', Size: 100 } } },
      },
      { name: 'campaigns.list', class: 'read', requiredScopes: [scope], description: 'Read Search campaigns, budgets and status for the selected account.', parameters: parameters({}), request: { method: 'POST', path: '/Campaigns/QueryByAccountId', headers: accountHeaders, body: { AccountId: '{accountId}', CampaignType: 'Search' } } },
      write('campaigns.createSearch', 'Create a PAUSED Search campaign with a DAILY budget in account currency and MaxClicks bidding capped by maximum CPC. This is not a lifetime spend cap. Configure dated ad groups, location targeting and ads before enabling.', '/Campaigns',
        { name: text, dailyBudget: money, maxCpc: money, languages: { type: 'array', minItems: 1, items: text }, isPolitical: { type: 'boolean' } }, ['name', 'dailyBudget', 'maxCpc', 'languages', 'isPolitical'],
        { AccountId: '{accountId}', Campaigns: [{ Name: '{name}', CampaignType: 'Search', Status: 'Paused', BudgetType: 'DailyBudgetStandard', DailyBudget: '{dailyBudget}', BiddingScheme: { Type: 'MaxClicks', MaxCpc: { Amount: '{maxCpc}' } }, Languages: '{languages}', IsPolitical: '{isPolitical}' }] }),
      write('adGroups.create', 'Create a PAUSED Search ad group with explicit start/end dates and currency CPC bid. Serving is limited to Microsoft owned and operated networks; the parent daily budget is not a total cap.', '/AdGroups',
        { campaignId: id, name: text, cpcBid: money, startDate: date, endDate: date }, ['campaignId', 'name', 'cpcBid', 'startDate', 'endDate'],
        { CampaignId: '{campaignId}', AdGroups: [{ Name: '{name}', Status: 'Paused', Network: 'OwnedAndOperatedOnly', CpcBid: { Amount: '{cpcBid}' }, StartDate: '{startDate}', EndDate: '{endDate}' }] }),
      write('keywords.create', 'Create an active Search keyword with an explicit match type and currency bid. Create under a paused ad group before launch.', '/Keywords',
        { adGroupId: id, text, matchType: { type: 'string', enum: ['Exact', 'Phrase', 'Broad'] }, bid: money }, ['adGroupId', 'text', 'matchType', 'bid'],
        { AdGroupId: '{adGroupId}', Keywords: [{ Text: '{text}', MatchType: '{matchType}', Bid: { Amount: '{bid}' }, Status: 'Active' }] }),
      write('campaigns.addLocation', 'Add a positive geographic criterion using a Microsoft location ID. Location IDs come from Microsoft geographic location codes; verify location intent settings and targeting before launch.', '/CampaignCriterions',
        { campaignId: id, locationId: id }, ['campaignId', 'locationId'],
        { CampaignCriterions: [{ CampaignId: '{campaignId}', Type: 'BiddableCampaignCriterion', Criterion: { Type: 'LocationCriterion', LocationId: '{locationId}' }, CriterionBid: { Type: 'BidMultiplier', Multiplier: 0 } }], CriterionType: 'Location' }),
      write('ads.createResponsiveSearch', 'Create a PAUSED responsive Search ad, subject to editorial review. Supply 3–15 headlines and 2–4 descriptions, with at least one final URL.', '/Ads',
        { adGroupId: id, headlines: { type: 'array', minItems: 3, maxItems: 15, items: { ...text, maxLength: 30 } }, descriptions: { type: 'array', minItems: 2, maxItems: 4, items: { ...text, maxLength: 90 } }, finalUrls: { type: 'array', minItems: 1, items: { type: 'string', format: 'uri' } } }, ['adGroupId', 'headlines', 'descriptions', 'finalUrls'],
        { AdGroupId: '{adGroupId}', Ads: [{ Type: 'ResponsiveSearch', Status: 'Paused', Headlines: '{headlines}', Descriptions: '{descriptions}', FinalUrls: '{finalUrls}' }] }),
      ...(['Active', 'Paused'] as const).flatMap(status => [
        write(`campaigns.${status === 'Active' ? 'enable' : 'pause'}`, status === 'Active' ? 'Enable the campaign. Active child entities can spend immediately; confirm billing, daily budget, dated ad groups, targeting and authorization.' : 'Pause campaign delivery and verify provider status and delayed spend.', '/Campaigns', { campaignId: id }, ['campaignId'], { AccountId: '{accountId}', Campaigns: [{ Id: '{campaignId}', Status: status }] }, 'PUT'),
        write(`adGroups.${status === 'Active' ? 'enable' : 'pause'}`, 'Set the ad group serving state. Enabling under an active campaign can spend immediately.', '/AdGroups', { campaignId: id, adGroupId: id }, ['campaignId', 'adGroupId'], { CampaignId: '{campaignId}', AdGroups: [{ Id: '{adGroupId}', Status: status }] }, 'PUT'),
        write(`ads.${status === 'Active' ? 'enable' : 'pause'}`, 'Set a responsive Search ad serving state. Enabling under active parents can spend immediately.', '/Ads', { adGroupId: id, adId: id }, ['adGroupId', 'adId'], { AdGroupId: '{adGroupId}', Ads: [{ Id: '{adId}', Type: 'ResponsiveSearch', Status: status }] }, 'PUT'),
      ]),
      {
        name: 'reports.requestCampaigns', class: 'read', requiredScopes: [scope], description: 'Submit a daily campaign performance CSV report for a closed date range. Returns ReportRequestId; poll reports.get. Spend is in account currency and attribution can lag.',
        parameters: parameters({ startDate: date, endDate: date }, ['startDate', 'endDate']),
        request: { method: 'POST', path: `${reportService}/GenerateReport/Submit`, headers: accountHeaders, body: { ReportRequest: { Type: 'CampaignPerformanceReportRequest', Format: 'Csv', Aggregation: 'Daily', ReturnOnlyCompleteData: true, Columns: ['TimePeriod', 'AccountId', 'CampaignId', 'CampaignName', 'Impressions', 'Clicks', 'Spend', 'Conversions'], Scope: { AccountIds: ['{accountId}'] }, Time: { CustomDateRangeStart: '{startDate}', CustomDateRangeEnd: '{endDate}' } } } },
      },
      {
        name: 'reports.get', class: 'read', requiredScopes: [scope], description: 'Poll report status and retrieve its expiring download URL. Download without forwarding advertising credentials; never interpret Pending as completed data.',
        parameters: parameters({ reportRequestId: text }, ['reportRequestId']), request: { method: 'POST', path: `${reportService}/GenerateReport/Poll`, headers: accountHeaders, body: { ReportRequestId: '{reportRequestId}' } },
      },
    ],
  })
  return {
    ...rest,
    async executeMutation(inv) {
      if (inv.capabilityName === 'ads.createResponsiveSearch') {
        const assets = (value: unknown) => {
          if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error('Microsoft Search ad assets must be arrays of text')
          return value.map(Text => ({ Asset: { Type: 'TextAsset', Text } }))
        }
        inv = { ...inv, args: { ...inv.args, headlines: assets(inv.args.headlines), descriptions: assets(inv.args.descriptions) } }
      }
      const result = await rest.executeMutation!(inv)
      if (result.status === 'committed' && result.data && typeof result.data === 'object' && 'PartialErrors' in result.data && Array.isArray(result.data.PartialErrors) && result.data.PartialErrors.length) {
        throw new Error(`microsoft-ads rejected the item (${result.data.PartialErrors.length} provider errors); inspect account permissions and field constraints before retrying`)
      }
      return result
    },
  }
}
