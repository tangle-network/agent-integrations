import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'

const scope = 'https://www.googleapis.com/auth/adwords'
const id = { type: 'string', pattern: '^[0-9]+$', description: 'Numeric ID without hyphens.' }
const text = { type: 'string', minLength: 1 }
const micros = { type: 'string', pattern: '^[1-9][0-9]*$', description: 'Positive integer micros in the customer currency; 1000000 = one currency unit.' }
const dateTime = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$', description: 'yyyy-MM-dd HH:mm:ss in the customer timezone. Total-budget campaigns require a fixed end.' }
const campaign = 'customers/{customerId}/campaigns/{campaignId}'
const adGroup = 'customers/{customerId}/adGroups/{adGroupId}'

function parameters(properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'object',
    properties: {
      customerId: id,
      loginCustomerId: { ...id, description: 'Optional manager account ID when accessing a managed customer.' },
      ...properties,
    },
    required: ['customerId', ...required],
    additionalProperties: false,
  }
}

function mutation(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  mutateOperations: Record<string, unknown>[],
): RestOperationSpec {
  return {
    name, description, class: 'mutation', cas: 'none', externalEffect: true,
    requiredScopes: [scope],
    parameters: parameters({
      ...properties,
      validateOnly: { type: 'boolean', description: 'Ask Google to validate without creating or changing resources.' },
    }, required),
    request: {
      method: 'POST', path: '/v25/customers/{customerId}/googleAds:mutate',
      headers: { 'login-customer-id': '{loginCustomerId}' },
      body: { mutateOperations, partialFailure: false, validateOnly: '{validateOnly}' },
    },
  }
}

/** Provider-enforced total budgets; no daily-budget or arbitrary mutate escape hatch.
 * Google v25 uses the OAuth Cloud project's access level, not developer tokens.
 * https://developers.google.com/google-ads/api/docs/campaigns/budgets/create-budgets
 */
export const googleAdsConnector = declarativeRestConnector({
  kind: 'google-ads',
  displayName: 'Google Ads',
  description: 'Create total-budget Search campaigns, manage ads and targeting, launch or pause campaigns, and report spend and conversions.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [scope],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
  },
  category: 'other',
  defaultConsistencyModel: 'cache',
  baseUrl: 'https://googleads.googleapis.com',
  // A 403 can mean Cloud-project approval or account permissions, not expired OAuth.
  credentialsExpiredStatuses: [401],
  test: { method: 'GET', path: '/v25/customers:listAccessibleCustomers' },
  capabilities: [
    {
      name: 'customers.listAccessible', class: 'read', requiredScopes: [scope],
      description: 'List directly accessible customer IDs. For managers, query customer_client to discover advertiser accounts.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      request: { method: 'GET', path: '/v25/customers:listAccessibleCustomers' },
    },
    {
      name: 'reports.search', class: 'read', requiredScopes: [scope],
      description: 'Run GAQL for account currency/timezone, campaign budgets/status, ad review, billing readiness, spend, clicks, and configured conversion metrics. Follow nextPageToken.',
      parameters: parameters({
        query: { ...text, description: 'Google Ads Query Language SELECT query. Monetary metrics use customer currency micros; conversion metrics require configured tracking.' },
        pageToken: { type: 'string' },
      }, ['query']),
      request: {
        method: 'POST', path: '/v25/customers/{customerId}/googleAds:search',
        headers: { 'login-customer-id': '{loginCustomerId}' },
        body: { query: '{query}', pageToken: '{pageToken}' },
      },
    },
    mutation('campaigns.createSearch',
      'Atomically create a PAUSED Search campaign and non-shared TOTAL budget. Verify customer currency/timezone first; configure targeting and ads before enabling.',
      { name: text, totalAmountMicros: micros, startDateTime: dateTime, endDateTime: dateTime,
        containsEuPoliticalAdvertising: { type: 'string', enum: ['DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING', 'CONTAINS_EU_POLITICAL_ADVERTISING'] },
      },
      ['name', 'totalAmountMicros', 'startDateTime', 'endDateTime', 'containsEuPoliticalAdvertising'],
      [
        { campaignBudgetOperation: { create: {
          resourceName: 'customers/{customerId}/campaignBudgets/-1', name: '{name}',
          totalAmountMicros: '{totalAmountMicros}', period: 'CUSTOM_PERIOD',
          explicitlyShared: false, deliveryMethod: 'STANDARD',
        } } },
        { campaignOperation: { create: {
          resourceName: 'customers/{customerId}/campaigns/-2', name: '{name}',
          campaignBudget: 'customers/{customerId}/campaignBudgets/-1',
          status: 'PAUSED', advertisingChannelType: 'SEARCH', manualCpc: {},
          startDateTime: '{startDateTime}', endDateTime: '{endDateTime}',
          containsEuPoliticalAdvertising: '{containsEuPoliticalAdvertising}',
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
        } } },
      ]),
    ...(['ENABLED', 'PAUSED'] as const).map(status => mutation(
      status === 'ENABLED' ? 'campaigns.enable' : 'campaigns.pause',
      status === 'ENABLED'
        ? 'Launch a campaign. Verify authorization, total budget, end time, targeting, billing, and ad review first; enabling can spend immediately.'
        : 'Pause a campaign to stop serving ads. Read status and spend after pausing; reporting can lag.',
      { campaignId: id }, ['campaignId'],
      [{ campaignOperation: { update: { resourceName: campaign, status }, updateMask: 'status' } }],
    )),
    mutation('adGroups.create',
      'Create an enabled Search ad group with a maximum CPC bid. A paused parent campaign prevents serving until launched.',
      { campaignId: id, name: text, cpcBidMicros: micros }, ['campaignId', 'name', 'cpcBidMicros'],
      [{ adGroupOperation: { create: { campaign, name: '{name}', type: 'SEARCH_STANDARD', status: 'ENABLED', cpcBidMicros: '{cpcBidMicros}' } } }]),
    mutation('keywords.create',
      'Add a positive or negative keyword to an ad group. Exact and phrase match constrain search intent more tightly than broad match.',
      { adGroupId: id, text, matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'] }, negative: { type: 'boolean' } },
      ['adGroupId', 'text', 'matchType'],
      [{ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', negative: '{negative}', keyword: { text: '{text}', matchType: '{matchType}' } } } }]),
    mutation('ads.createResponsiveSearch',
      'Create an enabled responsive Search ad. Supply 3–15 unique headlines and 2–4 descriptions; Google reviews the ad before serving.',
      {
        adGroupId: id,
        finalUrls: { type: 'array', minItems: 1, items: { type: 'string', format: 'uri' } },
        headlines: textAssets(3, 15, 30), descriptions: textAssets(2, 4, 90),
        path1: { type: 'string', maxLength: 15 }, path2: { type: 'string', maxLength: 15 },
      }, ['adGroupId', 'finalUrls', 'headlines', 'descriptions'],
      [{ adGroupAdOperation: { create: { adGroup, status: 'ENABLED', ad: {
        finalUrls: '{finalUrls}', responsiveSearchAd: { headlines: '{headlines}', descriptions: '{descriptions}', path1: '{path1}', path2: '{path2}' },
      } } } }]),
    ...(['ENABLED', 'PAUSED'] as const).map(status => mutation(
      status === 'ENABLED' ? 'ads.enable' : 'ads.pause',
      status === 'ENABLED'
        ? 'Enable a reviewed ad within its existing campaign and budget. An enabled parent campaign can serve it immediately.'
        : 'Pause one ad after creating a replacement, preserving the campaign total budget and other ads.',
      { adGroupId: id, adId: id }, ['adGroupId', 'adId'],
      [{ adGroupAdOperation: { update: {
        resourceName: 'customers/{customerId}/adGroupAds/{adGroupId}~{adId}', status,
      }, updateMask: 'status' } }],
    )),
    mutation('campaigns.addLocation',
      'Target or exclude a geographic area. Discover geo_target_constant IDs with reports.search before adding targeting.',
      { campaignId: id, geoTargetConstantId: id, negative: { type: 'boolean' } }, ['campaignId', 'geoTargetConstantId'],
      [{ campaignCriterionOperation: { create: { campaign, negative: '{negative}', location: { geoTargetConstant: 'geoTargetConstants/{geoTargetConstantId}' } } } }]),
    mutation('campaigns.addLanguage',
      'Add a campaign language criterion. Discover language_constant IDs with reports.search.',
      { campaignId: id, languageConstantId: id }, ['campaignId', 'languageConstantId'],
      [{ campaignCriterionOperation: { create: { campaign, language: { languageConstant: 'languageConstants/{languageConstantId}' } } } }]),
  ],
})

function textAssets(minItems: number, maxItems: number, maxLength: number) {
  return {
    type: 'array', minItems, maxItems,
    items: { type: 'object', properties: { text: { ...text, maxLength } }, required: ['text'], additionalProperties: false },
  }
}
