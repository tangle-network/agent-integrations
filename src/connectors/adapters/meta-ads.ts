import { type ConnectorAdapter, type ConnectorInvocation } from '../types.js'
import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import { isPlainRecord } from './file-payload.js'

const id = { type: 'string', pattern: '^[0-9]+$', description: 'Numeric native ID. For accountId use account_id, without the act_ prefix.' }
const text = { type: 'string', minLength: 1 }
const money = { type: 'integer', minimum: 1, description: 'Positive amount in the ad account currency minor units, e.g. 10000 = USD 100. Confirm account currency first.' }
const dateTime = { type: 'string', format: 'date-time' }
const url = { type: 'string', format: 'uri', pattern: '^https://' }
const page = { limit: { type: 'integer', minimum: 1, maximum: 100 }, after: text }
const pageQuery = { limit: '{limit}', after: '{after}' }
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function mutation(name: string, description: string, properties: Record<string, unknown>, required: string[], path: string, body: Record<string, unknown>): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: ['ads_management'],
    parameters: parameters(properties, required), request: { method: 'POST', path, bodyEncoding: 'form', body } }
}

const base = declarativeRestConnector({
  kind: 'meta-ads', displayName: 'Meta Ads',
  description: 'Manage Facebook and Instagram paid traffic campaigns, bounded budgets, ad sets, link creatives, delivery status and insights.',
  category: 'other', defaultConsistencyModel: 'cache',
  auth: { kind: 'oauth2', authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v25.0/oauth/access_token',
    scopes: ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement'], pkce: 'unsupported',
    clientIdEnv: 'META_ADS_OAUTH_CLIENT_ID', clientSecretEnv: 'META_ADS_OAUTH_CLIENT_SECRET' },
  baseUrl: 'https://graph.facebook.com/v25.0',
  credentialsExpiredStatuses: [401],
  test: { method: 'GET', path: '/me/adaccounts', query: { fields: 'id,account_id,name,account_status,currency,timezone_name', limit: 1 } },
  capabilities: [
    { name: 'accounts.list', class: 'read', description: 'Discover permitted ad accounts, currencies, timezones and readiness. Follow paging.cursors.after.',
      requiredScopes: ['ads_read'], parameters: parameters(page),
      request: { method: 'GET', path: '/me/adaccounts', query: { fields: 'id,account_id,name,account_status,currency,timezone_name,amount_spent,spend_cap', ...pageQuery } } },
    { name: 'pages.list', class: 'read', description: 'Discover Pages and their linked Instagram business identities for ad creatives. Page access tokens are deliberately not requested.',
      requiredScopes: ['pages_show_list'], parameters: parameters(page),
      request: { method: 'GET', path: '/me/accounts', query: { fields: 'id,name,instagram_business_account{id,username}', ...pageQuery } } },
    ...([
      ['campaigns', 'id,name,status,effective_status,objective,spend_cap,budget_remaining'],
      ['adsets', 'id,name,campaign_id,status,effective_status,lifetime_budget,budget_remaining,start_time,end_time,targeting'],
      ['ads', 'id,name,campaign_id,adset_id,status,effective_status,creative,issues_info'],
      ['adcreatives', 'id,name,object_story_spec,thumbnail_url'],
    ] as const).map(([edge, fields]): RestOperationSpec => ({ name: `${edge === 'adsets' ? 'adSets' : edge === 'adcreatives' ? 'creatives' : edge}.list`, class: 'read', requiredScopes: ['ads_read'],
      description: `Read ${edge} in an ad account, including native IDs and readiness. Follow paging.cursors.after.`,
      parameters: parameters({ accountId: id, ...page }, ['accountId']),
      request: { method: 'GET', path: `/act_{accountId}/${edge}`, query: { fields, ...pageQuery } } })),
    mutation('campaigns.createTraffic', 'Create a PAUSED auction traffic campaign with an explicit campaign spend cap across all its ad sets. The cap is not a daily budget; configure bounded ad sets before enabling.',
      { accountId: id, name: text, spendCap: money, specialAdCategories: { type: 'array', items: { type: 'string', enum: ['HOUSING', 'EMPLOYMENT', 'FINANCIAL_PRODUCTS_SERVICES', 'ISSUES_ELECTIONS_POLITICS'] }, uniqueItems: true } },
      ['accountId', 'name', 'spendCap', 'specialAdCategories'], '/act_{accountId}/campaigns',
      { name: '{name}', objective: 'OUTCOME_TRAFFIC', buying_type: 'AUCTION', status: 'PAUSED', spend_cap: '{spendCap}', special_ad_categories: '{specialAdCategoriesJson}', is_adset_budget_sharing_enabled: false }),
    mutation('adSets.createTraffic', 'Create a PAUSED website-link-click ad set with a lifetime budget and fixed flight. Meta validates targeting and regional disclosure requirements; use a campaign spend cap as the aggregate limit.',
      { accountId: id, campaignId: id, name: text, lifetimeBudget: money, startTime: dateTime, endTime: dateTime,
        countries: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[A-Z]{2}$' }, uniqueItems: true },
        ageMin: { type: 'integer', minimum: 18, maximum: 65 }, ageMax: { type: 'integer', minimum: 18, maximum: 65 },
        dsaBeneficiary: text, dsaPayor: text },
      ['accountId', 'campaignId', 'name', 'lifetimeBudget', 'startTime', 'endTime', 'countries'], '/act_{accountId}/adsets',
      { name: '{name}', campaign_id: '{campaignId}', status: 'PAUSED', lifetime_budget: '{lifetimeBudget}',
        start_time: '{startTime}', end_time: '{endTime}', billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP', destination_type: 'WEBSITE', targeting: '{targetingJson}', dsa_beneficiary: '{dsaBeneficiary}', dsa_payor: '{dsaPayor}' }),
    mutation('creatives.createLink', 'Create a website link creative from a Page identity and a public HTTPS image. Supply instagramUserId for the Instagram identity. Provider review still applies.',
      { accountId: id, name: text, pageId: id, instagramUserId: id, link: url, imageUrl: url, message: text, headline: text,
        callToAction: { type: 'string', enum: ['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US', 'BOOK_TRAVEL', 'GET_QUOTE'] } },
      ['accountId', 'name', 'pageId', 'link', 'imageUrl', 'message', 'headline', 'callToAction'], '/act_{accountId}/adcreatives',
      { name: '{name}', object_story_spec: '{storyJson}' }),
    mutation('ads.create', 'Create a PAUSED ad using an existing creative and ad set; this does not launch the ad.',
      { accountId: id, name: text, adSetId: id, creativeId: id }, ['accountId', 'name', 'adSetId', 'creativeId'], '/act_{accountId}/ads',
      { name: '{name}', adset_id: '{adSetId}', creative: '{creativeJson}', status: 'PAUSED' }),
    ...(['campaigns', 'adSets', 'ads'] as const).flatMap(entity => (['ACTIVE', 'PAUSED'] as const).map(status => mutation(
      `${entity}.${status === 'ACTIVE' ? 'enable' : 'pause'}`,
      status === 'ACTIVE' ? 'Enable delivery of this object. Verify approved spending authority, parent campaign cap, flight, billing, targeting and review status first; all ancestors must be active to serve.' : 'Pause delivery of this object without changing budgets or creatives. Re-read effective status and spend afterward.',
      { objectId: id }, ['objectId'], '/{objectId}', { status }))),
    { name: 'reports.insights', class: 'read', requiredScopes: ['ads_read'],
      description: 'Read account, campaign, ad set or ad performance for an inclusive date range. Spend is in account currency units; actions require configured attribution and are not verified sales.',
      parameters: parameters({ accountId: id, since: { type: 'string', format: 'date' }, until: { type: 'string', format: 'date' },
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'] }, ...page }, ['accountId', 'since', 'until', 'level']),
      request: { method: 'GET', path: '/act_{accountId}/insights', query: { fields: 'account_id,account_currency,campaign_id,campaign_name,adset_id,ad_id,impressions,clicks,spend,actions,action_values',
        level: '{level}', time_range: '{timeRangeJson}', ...pageQuery } } },
  ],
})

// Graph's form protocol JSON-encodes compound fields. Build only the declared
// structure so caller-supplied status/budget/payload fields cannot replace it.
function prepare(inv: ConnectorInvocation): ConnectorInvocation {
  const a = inv.args
  if (inv.capabilityName === 'campaigns.createTraffic' && (!Number.isSafeInteger(a.spendCap) || Number(a.spendCap) <= 0)) throw new Error('meta-ads: spendCap must be a positive safe integer')
  if (inv.capabilityName === 'adSets.createTraffic') {
    if (!Number.isSafeInteger(a.lifetimeBudget) || Number(a.lifetimeBudget) <= 0) throw new Error('meta-ads: lifetimeBudget must be a positive safe integer')
    if (!(Date.parse(String(a.endTime)) > Date.parse(String(a.startTime)))) throw new Error('meta-ads: endTime must be after startTime')
  }
  return { ...inv, args: { ...a,
    specialAdCategoriesJson: JSON.stringify(a.specialAdCategories),
    targetingJson: JSON.stringify({ geo_locations: { countries: a.countries }, age_min: a.ageMin, age_max: a.ageMax }),
    storyJson: JSON.stringify({ page_id: a.pageId, instagram_user_id: a.instagramUserId,
      link_data: { link: a.link, picture: a.imageUrl, message: a.message, name: a.headline, call_to_action: { type: a.callToAction, value: { link: a.link } } } }),
    creativeJson: JSON.stringify({ creative_id: a.creativeId }), timeRangeJson: JSON.stringify({ since: a.since, until: a.until }),
  } }
}

export const metaAdsConnector: ConnectorAdapter = {
  ...base,
  async executeRead(inv) {
    const result = await base.executeRead!(prepare(inv))
    // Graph pagination URLs may contain access tokens even with bearer auth.
    // Agents receive only cursors; subsequent reads rebuild the pinned URL.
    if (isPlainRecord(result.data) && isPlainRecord(result.data.paging)) {
      const { next: _next, previous: _previous, ...paging } = result.data.paging
      return { ...result, data: { ...result.data, paging } }
    }
    return result
  },
  executeMutation: async inv => base.executeMutation!(prepare(inv)),
}
