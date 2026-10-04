import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import { isPlainRecord } from './file-payload.js'

const id = { type: 'string', pattern: '^[0-9]+$' }
const text = { type: 'string', minLength: 1, maxLength: 255 }
const money = { type: 'string', pattern: '^(?:[1-9][0-9]*(?:\\.[0-9]{1,2})?|0\\.(?:0[1-9]|[1-9][0-9]?))$', description: 'Positive decimal amount in account currency, not micros.' }
const currency = { type: 'string', pattern: '^[A-Z]{3}$' }
const time = { type: 'integer', minimum: 1, description: 'Unix epoch milliseconds.' }
const facets = ['interfaceLocales', 'locations', 'industries', 'employers', 'jobFunctions', 'seniorities', 'titles', 'skills', 'staffCountRanges', 'interests']
const facetValues = Object.fromEntries(facets.map(facet => [facet, { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', pattern: '^urn:li:' } }]))
const targetingGroup = { type: 'object', properties: { or: { type: 'object', minProperties: 1, properties: facetValues, additionalProperties: false } }, required: ['or'], additionalProperties: false }
const targeting = {
  type: 'object', properties: {
    include: { type: 'object', properties: { and: { type: 'array', minItems: 1, maxItems: 9, items: targetingGroup } }, required: ['and'], additionalProperties: false },
    exclude: { type: 'object', properties: { or: { type: 'object', minProperties: 1, properties: facetValues, additionalProperties: false } }, required: ['or'], additionalProperties: false },
  }, required: ['include'], additionalProperties: false,
  description: 'Targeting criteria with short facet names (locations, interfaceLocales, etc.). Include a locations facet using current Bing geo URNs discovered through targeting.search. OR within a facet, AND between groups.',
}
// Tool-schema property names must be model-safe; only the wire uses URN keys.
function nativeTargeting(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value) || !isPlainRecord(value.include) || !Array.isArray(value.include.and) || value.include.and.length === 0) throw new Error('linkedin-ads: targetingCriteria.include.and is required')
  const group = (entry: unknown) => {
    if (!isPlainRecord(entry) || !isPlainRecord(entry.or) || Object.keys(entry.or).length === 0) throw new Error('linkedin-ads: targeting group requires facets')
    return { or: Object.fromEntries(Object.entries(entry.or).map(([facet, values]) => {
      if (!facets.includes(facet) || !Array.isArray(values) || values.length === 0 || values.some(item => typeof item !== 'string' || !item.startsWith('urn:li:'))) throw new Error('linkedin-ads: unknown targeting facet or invalid URN values')
      return [`urn:li:adTargetingFacet:${facet}`, values]
    })) }
  }
  return { include: { and: value.include.and.map(group) }, ...(value.exclude === undefined ? {} : { exclude: group(value.exclude) }) }
}
const account = '/adAccounts/{accountId}'
const page = { pageSize: { type: 'integer', minimum: 1, maximum: 100 }, pageToken: { type: 'string' } }
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function write(name: string, description: string, path: string, properties: Record<string, unknown>, required: string[], body: Record<string, unknown>, create = false): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: ['rw_ads'],
    parameters: parameters({ accountId: id, ...properties }, ['accountId', ...required]),
    request: { method: 'POST', path: account + path, body,
      ...(create ? { resultFromHeader: { header: 'x-restli-id', field: 'id' } } : { headers: { 'X-RestLi-Method': 'PARTIAL_UPDATE' } }),
    } }
}

const base = declarativeRestConnector({
  kind: 'linkedin-ads', displayName: 'LinkedIn Ads',
  description: 'Discover advertiser accounts, prepare lifetime-budget sponsored campaigns, target professional audiences, sponsor existing posts, and measure results.',
  auth: { kind: 'oauth2', authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['rw_ads', 'r_ads_reporting'], clientIdEnv: 'LINKEDIN_OAUTH_CLIENT_ID', clientSecretEnv: 'LINKEDIN_OAUTH_CLIENT_SECRET' },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://api.linkedin.com/rest', credentialsExpiredStatuses: [401],
  defaultHeaders: { 'LinkedIn-Version': '202609', 'X-Restli-Protocol-Version': '2.0.0' },
  test: { method: 'GET', path: '/adAccounts', query: { q: 'search', pageSize: 1 } },
  capabilities: [
    { name: 'accounts.list', class: 'read', requiredScopes: ['rw_ads'], description: 'List accessible advertiser accounts, currency, account status and native nextPageToken. Includes test accounts.',
      parameters: parameters(page), request: { method: 'GET', path: '/adAccounts', query: { q: 'search', pageSize: '{pageSize}', pageToken: '{pageToken}' } } },
    ...(['adCampaignGroups', 'adCampaigns'] as const).flatMap(resource => {
      const name = resource === 'adCampaignGroups' ? 'campaignGroups' : 'campaigns'
      return [
        { name: `${name}.list`, class: 'read' as const, requiredScopes: ['rw_ads'], description: 'Read campaigns or groups with native budgets, serving holds and nextPageToken.',
          parameters: parameters({ accountId: id, ...page }, ['accountId']),
          request: { method: 'GET' as const, path: `${account}/${resource}`, query: { q: 'search', search: resource === 'adCampaignGroups' ? '(status:(values:List(ACTIVE,PAUSED,DRAFT,ARCHIVED)))' : '(status:(values:List(ACTIVE,PAUSED,DRAFT,COMPLETED,ARCHIVED)))', pageSize: '{pageSize}', pageToken: '{pageToken}' } } },
        { name: `${name}.get`, class: 'read' as const, requiredScopes: ['rw_ads'], description: 'Inspect a native campaign or group budget, schedule and serving status.',
          parameters: parameters({ accountId: id, id }, ['accountId', 'id']), request: { method: 'GET' as const, path: `${account}/${resource}/{id}` } },
      ]
    }),
    write('campaignGroups.create', 'Create a DRAFT campaign group with a cumulative total budget and fixed schedule. New groups only accept DRAFT or ACTIVE at creation.', '/adCampaignGroups',
      { name: text, totalBudget: money, currencyCode: currency, startTime: time, endTime: time }, ['name', 'totalBudget', 'currencyCode', 'startTime', 'endTime'],
      { account: 'urn:li:sponsoredAccount:{accountId}', name: '{name}', status: 'DRAFT', totalBudget: { amount: '{totalBudget}', currencyCode: '{currencyCode}' }, runSchedule: { start: '{startTime}', end: '{endTime}' } }, true),
    ...(['ACTIVE', 'PAUSED'] as const).map(status => write(status === 'ACTIVE' ? 'campaignGroups.enable' : 'campaignGroups.pause',
      status === 'ACTIVE' ? 'Enable a campaign group. Active children can spend immediately; verify the group total budget and schedule first.' : 'Pause the entire campaign group.',
      '/adCampaignGroups/{groupId}', { groupId: id }, ['groupId'], { patch: { $set: { status } } })),
    write('campaigns.createSponsored', 'Create a PAUSED sponsored-content campaign with lifetime pacing, a total budget, fixed schedule and maximum CPC bid. Include geographic targeting. Reuse existing LinkedIn posts for creatives.', '/adCampaigns',
      { name: text, groupId: id, associatedEntity: { type: 'string', pattern: '^urn:li:(organization:[0-9]+|person:[A-Za-z0-9_-]+)$', description: 'Beneficiary organization or member URN with sponsorship rights for this campaign.' }, totalBudget: money, currencyCode: currency, bidAmount: money, startTime: time, endTime: time, targetingCriteria: targeting,
        localeCountry: { type: 'string', pattern: '^[A-Z]{2}$' }, localeLanguage: { type: 'string', pattern: '^[a-z]{2}$' },
        politicalIntent: { type: 'string', enum: ['NOT_POLITICAL', 'POLITICAL', 'NOT_DECLARED'], description: 'For EU targeting the advertiser must provide the LinkedIn political advertising declaration before submission.' },
      }, ['name', 'groupId', 'associatedEntity', 'totalBudget', 'currencyCode', 'bidAmount', 'startTime', 'endTime', 'targetingCriteria', 'localeCountry', 'localeLanguage', 'politicalIntent'],
      { account: 'urn:li:sponsoredAccount:{accountId}', campaignGroup: 'urn:li:sponsoredCampaignGroup:{groupId}', associatedEntity: '{associatedEntity}', name: '{name}', type: 'SPONSORED_UPDATES', objectiveType: 'WEBSITE_VISIT', status: 'PAUSED', pacingStrategy: 'LIFETIME',
        totalBudget: { amount: '{totalBudget}', currencyCode: '{currencyCode}' }, unitCost: { amount: '{bidAmount}', currencyCode: '{currencyCode}' }, costType: 'CPC', optimizationTargetType: 'NONE',
        runSchedule: { start: '{startTime}', end: '{endTime}' }, targetingCriteria: '{targetingCriteria}', locale: { country: '{localeCountry}', language: '{localeLanguage}' },
        audienceExpansionEnabled: false, offsiteDeliveryEnabled: false, creativeSelection: 'OPTIMIZED', politicalIntent: '{politicalIntent}' }, true),
    ...(['ACTIVE', 'PAUSED'] as const).map(status => write(status === 'ACTIVE' ? 'campaigns.enable' : 'campaigns.pause',
      status === 'ACTIVE' ? 'Enable an existing lifetime-budget campaign. Verify total budget, end date, targeting, ad review, funding and authorization first; this can spend immediately.' : 'Pause the campaign and stop delivery.',
      '/adCampaigns/{campaignId}', { campaignId: id }, ['campaignId'], { patch: { $set: { status } } })),
    { name: 'targeting.search', class: 'read', requiredScopes: ['rw_ads'], description: 'Find current native targeting URNs by facet and text. Geographic results use Bing geo; do not reuse obsolete geo IDs.',
      parameters: parameters({ facet: { type: 'string', enum: ['locations', 'industries', 'employers', 'titles', 'skills', 'interests'] }, query: text }, ['facet', 'query']),
      request: { method: 'GET', path: '/adTargetingEntities', query: { q: 'typeahead', facet: 'urn:li:adTargetingFacet:{facet}', query: '{query}', queryVersion: 'QUERY_USES_URNS' } } },
    { name: 'targeting.listFacet', class: 'read', requiredScopes: ['rw_ads'], description: 'List professional targeting facet values for job function, seniority and company size.',
      parameters: parameters({ facet: { type: 'string', enum: ['jobFunctions', 'seniorities', 'staffCountRanges'] } }, ['facet']),
      request: { method: 'GET', path: '/adTargetingEntities', query: { q: 'adTargetingFacet', facet: 'urn:li:adTargetingFacet:{facet}', queryVersion: 'QUERY_USES_URNS' } } },
    write('creatives.createFromPost', 'Create a PAUSED sponsored creative referencing a share or UGC post. Author content using the existing LinkedIn publishing connector; the advertiser must have sponsorship rights.', '/creatives',
      { campaignId: id, postUrn: { type: 'string', pattern: '^urn:li:(share|ugcPost):[0-9]+$' }, name: text }, ['campaignId', 'postUrn', 'name'],
      { campaign: 'urn:li:sponsoredCampaign:{campaignId}', content: { reference: '{postUrn}' }, intendedStatus: 'PAUSED', name: '{name}' }, true),
    { name: 'creatives.get', class: 'read', requiredScopes: ['rw_ads'], description: 'Read ad review, serving holds and effective serving state using the returned creative URN.',
      parameters: parameters({ accountId: id, creativeUrn: { type: 'string', pattern: '^urn:li:sponsoredCreative:[0-9]+$' } }, ['accountId', 'creativeUrn']),
      request: { method: 'GET', path: `${account}/creatives/{creativeUrn}` } },
    ...(['ACTIVE', 'PAUSED'] as const).map(status => write(status === 'ACTIVE' ? 'creatives.enable' : 'creatives.pause',
      status === 'ACTIVE' ? 'Activate a creative for review and serving within its campaign budget; an active parent may spend immediately.' : 'Pause a creative. LinkedIn may reject pausing a creative currently under review; pause its campaign instead.',
      '/creatives/{creativeUrn}', { creativeUrn: { type: 'string', pattern: '^urn:li:sponsoredCreative:[0-9]+$' } }, ['creativeUrn'], { patch: { $set: { intendedStatus: status } } })),
    { name: 'reports.analytics', class: 'read', requiredScopes: ['r_ads_reporting'], description: 'Read campaign spend in account currency, impressions, clicks and configured website conversions for an inclusive UTC date range. Provider attribution is not proof of revenue.',
      parameters: parameters({ accountId: id, startYear: { type: 'integer', minimum: 2000 }, startMonth: { type: 'integer', minimum: 1, maximum: 12 }, startDay: { type: 'integer', minimum: 1, maximum: 31 }, endYear: { type: 'integer', minimum: 2000 }, endMonth: { type: 'integer', minimum: 1, maximum: 12 }, endDay: { type: 'integer', minimum: 1, maximum: 31 } }, ['accountId', 'startYear', 'startMonth', 'startDay', 'endYear', 'endMonth', 'endDay']),
      request: { method: 'GET', path: '/adAnalytics', query: { q: 'analytics', pivot: 'CAMPAIGN', accounts: 'List(urn:li:sponsoredAccount:{accountId})', timeGranularity: 'DAILY',
        dateRange: '(start:(year:{startYear},month:{startMonth},day:{startDay}),end:(year:{endYear},month:{endMonth},day:{endDay}))', fields: 'dateRange,pivotValues,impressions,clicks,landingPageClicks,costInLocalCurrency,externalWebsiteConversions' } } },
  ],
})

export const linkedinAdsConnector = {
  ...base,
  async executeMutation(inv: Parameters<NonNullable<typeof base.executeMutation>>[0]) {
    for (const key of ['totalBudget', 'bidAmount']) {
      if (inv.args[key] !== undefined && (typeof inv.args[key] !== 'string' || !new RegExp(money.pattern).test(inv.args[key]))) throw new Error(`linkedin-ads: ${key} must be positive decimal currency`)
    }
    if (inv.capabilityName === 'campaignGroups.create' || inv.capabilityName === 'campaigns.createSponsored') {
      if (!(typeof inv.args.startTime === 'number' && typeof inv.args.endTime === 'number' && Number.isSafeInteger(inv.args.startTime) && Number.isSafeInteger(inv.args.endTime) && Number(inv.args.startTime) > 0 && Number(inv.args.endTime) > Number(inv.args.startTime))) throw new Error('linkedin-ads: endTime must be after startTime in epoch milliseconds')
    }
    if (inv.capabilityName === 'campaigns.createSponsored') inv = { ...inv, args: { ...inv.args, targetingCriteria: nativeTargeting(inv.args.targetingCriteria) } }
    const result = await base.executeMutation!(inv)
    if (result.status === 'committed') {
      const creating = ['campaignGroups.create', 'campaigns.createSponsored', 'creatives.createFromPost'].includes(inv.capabilityName)
      if (creating ? !(isPlainRecord(result.data) && typeof result.data.id === 'string' && result.data.id.length > 0) : result.data !== null) {
        throw new Error('linkedin-ads: unexpected mutation receipt; reconcile provider state before retrying')
      }
    }
    return result
  },
}
