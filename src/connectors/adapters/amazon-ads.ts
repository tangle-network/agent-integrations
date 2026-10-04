import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import type { ConnectorAdapter } from '../types.js'

const scope = 'advertising::campaign_management'
const text = { type: 'string', minLength: 1 }
const id = { ...text, pattern: '^[0-9]+$' }
const money = { type: 'number', exclusiveMinimum: 0, description: 'Amount in the profile currency, not micros or cents. Provider marketplace minimums apply.' }
const date = { type: 'string', format: 'date', description: 'YYYY-MM-DD in the advertiser marketplace timezone.' }
const resources = { campaigns: ['spCampaign', 'campaignId'], adGroups: ['spAdGroup', 'adGroupId'], keywords: ['spKeyword', 'keywordId'], productAds: ['spProductAd', 'adId'] } as const
type Resource = keyof typeof resources
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: { profileId: id, ...properties }, required: ['profileId', ...required], additionalProperties: false }
}
function headers(resource: Resource) {
  const media = `application/vnd.${resources[resource][0]}.v3+json`
  return { 'Amazon-Advertising-API-Scope': '{profileId}', accept: media, 'content-type': media }
}
function write(name: string, description: string, resource: Resource, properties: Record<string, unknown>, required: string[], item: Record<string, unknown>, method: 'POST' | 'PUT' = 'POST'): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: [scope], parameters: parameters(properties, required), request: { method, path: `/sp/${resource}`, headers: headers(resource), body: { [resource]: [item] } } }
}

export interface AmazonAdsOptions { clientId: string }

/** Application identity stays in trusted runtime configuration, never tool args. */
export function createAmazonAdsConnector(options: AmazonAdsOptions): ConnectorAdapter {
  if (!options.clientId?.trim()) throw new Error('Amazon Ads requires its approved application clientId')
  const rest = declarativeRestConnector({
    kind: 'amazon-ads', displayName: 'Amazon Ads', description: 'Manage Sponsored Products for eligible Amazon sellers/vendors, marketplace profiles and campaign reports. Not a general SaaS display-ad connector.',
    auth: { kind: 'oauth2', authorizationUrl: 'https://www.amazon.com/ap/oa', tokenUrl: 'https://api.amazon.com/auth/o2', scopes: [scope], clientIdEnv: 'AMAZON_ADS_CLIENT_ID', clientSecretEnv: 'AMAZON_ADS_CLIENT_SECRET' },
    category: 'other', defaultConsistencyModel: 'cache', credentialsExpiredStatuses: [401],
    baseUrl: { metadataKey: 'apiBaseUrl', fallback: 'https://advertising-api.amazon.com' },
    allowedBaseUrls: ['https://advertising-api.amazon.com', 'https://advertising-api-eu.amazon.com', 'https://advertising-api-fe.amazon.com'],
    credentialHeaders: { 'Amazon-Advertising-API-ClientId': options.clientId },
    test: { method: 'GET', path: '/v2/profiles' },
    capabilities: [
      { name: 'profiles.list', class: 'read', requiredScopes: [scope], description: 'Discover authorized marketplace profiles, currency, timezone, and seller/vendor account type on the configured regional endpoint.', parameters: { type: 'object', properties: {}, additionalProperties: false }, request: { method: 'GET', path: '/v2/profiles' } },
      ...Object.keys(resources).map(resourceName => {
        const resource = resourceName as Resource
        return { name: `${resource}.list`, class: 'read' as const, requiredScopes: [scope], description: `List Sponsored Products ${resource} and native statuses; use nextToken for pagination.`, parameters: parameters({ nextToken: text }), request: { method: 'POST' as const, path: `/sp/${resource}/list`, headers: headers(resource), body: { nextToken: '{nextToken}', maxResults: 100 } } }
      }),
      write('campaigns.createSponsoredProducts', 'Create a PAUSED manual Sponsored Products campaign. DAILY budget is in profile currency and is an average daily budget, not a hard daily or lifetime spend cap. Required end date bounds the schedule; only eligible products may advertise.', 'campaigns',
        { name: text, dailyBudget: money, startDate: date, endDate: date }, ['name', 'dailyBudget', 'startDate', 'endDate'],
        { name: '{name}', state: 'PAUSED', targetingType: 'MANUAL', budget: { budgetType: 'DAILY', budget: '{dailyBudget}' }, startDate: '{startDate}', endDate: '{endDate}', dynamicBidding: { strategy: 'LEGACY_FOR_SALES' } }),
      write('adGroups.create', 'Create a PAUSED Sponsored Products ad group with a default bid in profile currency.', 'adGroups',
        { campaignId: id, name: text, defaultBid: money }, ['campaignId', 'name', 'defaultBid'],
        { campaignId: '{campaignId}', name: '{name}', defaultBid: '{defaultBid}', state: 'PAUSED' }),
      write('keywords.create', 'Create a PAUSED keyword target in a manual Sponsored Products campaign. Bid is in profile currency; explicitly enable after review.', 'keywords',
        { campaignId: id, adGroupId: id, keywordText: text, matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'] }, bid: money }, ['campaignId', 'adGroupId', 'keywordText', 'matchType', 'bid'],
        { campaignId: '{campaignId}', adGroupId: '{adGroupId}', keywordText: '{keywordText}', matchType: '{matchType}', bid: '{bid}', state: 'PAUSED' }),
      ...(['sku', 'asin'] as const).map(productKey => write(
        productKey === 'sku' ? 'productAds.createSellerProduct' : 'productAds.createVendorProduct',
        `Create a PAUSED product ad for an eligible ${productKey === 'sku' ? 'seller SKU' : 'vendor ASIN'}. Product availability, account eligibility and Amazon review still apply; this cannot advertise arbitrary SaaS URLs.`,
        'productAds', { campaignId: id, adGroupId: id, [productKey]: text }, ['campaignId', 'adGroupId', productKey],
        { campaignId: '{campaignId}', adGroupId: '{adGroupId}', [productKey]: `{${productKey}}`, state: 'PAUSED' },
      )),
      ...Object.entries(resources).flatMap(([resourceName, [, entityKey]]) => (['ENABLED', 'PAUSED'] as const).map(state => write(
        `${resourceName}.${state === 'ENABLED' ? 'enable' : 'pause'}`,
        state === 'ENABLED' ? 'Enable the entity. When parents and targets are enabled this can spend immediately; verify product eligibility, budget, end date and authorization first.' : 'Pause the entity; confirm provider status and delayed spend afterward.',
        resourceName as Resource, { entityId: id }, ['entityId'], { [entityKey]: '{entityId}', state }, 'PUT',
      ))),
      {
        name: 'reports.requestCampaigns', class: 'read', requiredScopes: [scope], description: 'Request a daily Sponsored Products campaign report. Returns reportId; poll reports.get until COMPLETED. Costs are profile currency; attribution and reporting lag apply.',
        parameters: parameters({ startDate: date, endDate: date }, ['startDate', 'endDate']),
        request: { method: 'POST', path: '/reporting/reports', headers: { 'Amazon-Advertising-API-Scope': '{profileId}', 'content-type': 'application/vnd.createasyncreportrequest.v3+json' }, body: { startDate: '{startDate}', endDate: '{endDate}', configuration: { adProduct: 'SPONSORED_PRODUCTS', groupBy: ['campaign'], columns: ['date', 'campaignId', 'campaignName', 'impressions', 'clicks', 'cost'], reportTypeId: 'spCampaigns', timeUnit: 'DAILY', format: 'GZIP_JSON' } } },
      },
      {
        name: 'reports.get', class: 'read', requiredScopes: [scope], description: 'Read asynchronous report status and its expiring download URL. Download completed GZIP_JSON without forwarding advertising credentials to the download host.',
        parameters: parameters({ reportId: text }, ['reportId']), request: { method: 'GET', path: '/reporting/reports/{reportId}', headers: { 'Amazon-Advertising-API-Scope': '{profileId}' } },
      },
    ],
  })
  return {
    ...rest,
    async executeMutation(inv) {
      const result = await rest.executeMutation!(inv)
      if (result.status !== 'committed') return result
      const resource = inv.capabilityName.split('.')[0] as Resource
      const receipt = record(record(result.data)?.[resource])
      if (!receipt) throw new Error('amazon-ads returned no resource receipt; reconcile provider state before retrying')
      if (receipt.error != null && !Array.isArray(receipt.error)) throw new Error('amazon-ads returned an invalid error receipt; reconcile provider state before retrying')
      if (Array.isArray(receipt.error) && receipt.error.length) throw new Error(`amazon-ads rejected the item (${receipt.error.length} provider errors); inspect profile eligibility and field constraints before retrying`)
      const success = Array.isArray(receipt.success) && receipt.success.length === 1 ? record(receipt.success[0]) : undefined
      if (!success || success.index !== 0) throw new Error('amazon-ads returned no single-item success receipt; reconcile provider state before retrying')
      // Native updates may acknowledge only index. Creates must return an ID
      // (or its full representation), so the next ad operation has an identity.
      if (inv.capabilityName.includes('.create')) {
        const [, idKey] = resources[resource]
        const entityKey = { campaigns: 'campaign', adGroups: 'adGroup', keywords: 'keyword', productAds: 'productAd' }[resource]
        const entityId = success[idKey] ?? record(success[entityKey])?.[idKey]
        if (typeof entityId !== 'string' || !entityId.trim()) throw new Error('amazon-ads returned no created entity ID; reconcile provider state before retrying')
      }
      return result
    },
  }
}
