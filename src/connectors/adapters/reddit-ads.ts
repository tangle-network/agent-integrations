import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'

const id = { type: 'string', pattern: '^[a-zA-Z0-9_-]+$' }
const text = { type: 'string', minLength: 1, maxLength: 255 }
const time = { type: 'string', format: 'date-time' }
const url = { type: 'string', format: 'uri', pattern: '^https://' }
const micros = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Positive integer microcurrency in the advertiser account currency; 1000000 = one currency unit.' }
const page = { pageToken: { type: 'string' }, pageSize: { type: 'integer', minimum: 1, maximum: 100 } }
const pageQuery = { 'page.token': '{pageToken}', 'page.size': '{pageSize}' }
const account = '/ad_accounts/{accountId}'
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function strings(maxItems: number) { return { type: 'array', minItems: 1, maxItems, items: { type: 'string', minLength: 1 } } }
function write(name: string, description: string, path: string, properties: Record<string, unknown>, required: string[], data: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST'): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: ['adsedit'],
    parameters: parameters(properties, required), request: { method, path, body: { data } } }
}

const base = declarativeRestConnector({
  kind: 'reddit-ads', displayName: 'Reddit Ads',
  description: 'Prepare lifetime-budget Reddit traffic campaigns, target communities and geographies, create ad creatives, launch or pause, and measure spend and conversions.',
  auth: { kind: 'oauth2', authorizationUrl: 'https://www.reddit.com/api/v1/authorize', tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scopes: ['adsread', 'adsedit'], pkce: 'unsupported', tokenClientAuthMethod: 'client_secret_basic', extraAuthParams: { duration: 'permanent' },
    clientIdEnv: 'REDDIT_ADS_OAUTH_CLIENT_ID', clientSecretEnv: 'REDDIT_ADS_OAUTH_CLIENT_SECRET',
    tokenRequestHeaders: { 'User-Agent': 'web:tools.tangle.integration-hub:v1.0 (contact: https://tangle.tools)' } },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://ads-api.reddit.com/api/v3', credentialsExpiredStatuses: [401],
  defaultHeaders: { 'User-Agent': 'web:tools.tangle.integration-hub:v1.0 (contact: https://tangle.tools)' },
  test: { method: 'GET', path: '/me/businesses', query: { 'page.size': 1 } },
  capabilities: [
    { name: 'businesses.list', class: 'read', requiredScopes: ['adsread'], description: 'Discover advertiser businesses available to the connected user. Follow pagination tokens.',
      parameters: parameters(page), request: { method: 'GET', path: '/me/businesses', query: pageQuery } },
    { name: 'accounts.list', class: 'read', requiredScopes: ['adsread'], description: 'List advertiser accounts in one accessible business. Use account currency and billing readiness before budgeting.',
      parameters: parameters({ businessId: id, ...page }, ['businessId']), request: { method: 'GET', path: '/businesses/{businessId}/ad_accounts', query: pageQuery } },
    { name: 'accounts.get', class: 'read', requiredScopes: ['adsread'], description: 'Read advertiser account currency, funding and serving status.',
      parameters: parameters({ accountId: id }, ['accountId']), request: { method: 'GET', path: account } },
    ...(['campaigns', 'ad_groups', 'ads', 'pixels', 'profiles'] as const).map(resource => ({
      name: `${resource === 'ad_groups' ? 'adGroups' : resource}.list`, class: 'read' as const, requiredScopes: ['adsread'], description: `List ${resource} under this advertiser account. Retain provider IDs and pagination.`,
      parameters: parameters({ accountId: id, ...page }, ['accountId']), request: { method: 'GET' as const, path: `${account}/${resource}`, query: pageQuery },
    })),
    ...(['campaigns', 'ad_groups', 'ads'] as const).flatMap(resource => {
      const name = resource === 'ad_groups' ? 'adGroups' : resource
      return [
        { name: `${name}.get`, class: 'read' as const, requiredScopes: ['adsread'], description: 'Read native budget, schedule, configured status and effective serving status.',
          parameters: parameters({ id }, ['id']), request: { method: 'GET' as const, path: `/${resource}/{id}` } },
        ...(['ACTIVE', 'PAUSED'] as const).map(status => write(`${name}.${status === 'ACTIVE' ? 'enable' : 'pause'}`,
          status === 'ACTIVE' ? 'Enable this entity; delivery may start immediately if its parents are active. Verify lifetime campaign budget, schedule, creative review, targeting and authorization first.' : 'Pause this entity. Check effective status and reporting after the write.',
          `/${resource}/{id}`, { id }, ['id'], { configured_status: status }, 'PATCH')),
      ]
    }),
    write('campaigns.createTraffic', 'Create a PAUSED Standard traffic campaign with campaign budget optimization and a lifetime spending budget. A conversion pixel is required by Reddit, including traffic campaigns.', `${account}/campaigns`,
      { accountId: id, name: text, totalBudgetMicros: micros, startTime: time, endTime: time, pixelId: id }, ['accountId', 'name', 'totalBudgetMicros', 'startTime', 'endTime', 'pixelId'],
      { name: '{name}', configured_status: 'PAUSED', objective: 'CLICKS', is_campaign_budget_optimization: true, goal_type: 'LIFETIME_SPEND', goal_value: '{totalBudgetMicros}',
        start_time: '{startTime}', end_time: '{endTime}', bid_strategy: 'BIDLESS', bid_type: 'CPC', conversion_pixel_id: '{pixelId}' }),
    write('adGroups.createTraffic', 'Create a PAUSED traffic ad group inheriting the CBO campaign lifetime budget and bid strategy. Match campaign schedule and pixel. Targeting expansion is disabled.', `${account}/ad_groups`,
      { accountId: id, campaignId: id, name: text, startTime: time, endTime: time, pixelId: id, geolocations: strings(100), communities: strings(100), keywords: strings(1000), excludedCommunities: strings(100) },
      ['accountId', 'campaignId', 'name', 'startTime', 'endTime', 'pixelId', 'geolocations'],
      { campaign_id: '{campaignId}', name: '{name}', configured_status: 'PAUSED', start_time: '{startTime}', end_time: '{endTime}', bid_type: 'CPC', bid_strategy: null, bid_value: null, conversion_pixel_id: '{pixelId}',
        targeting: { geolocations: '{geolocations}', communities: '{communities}', keywords: '{keywords}', excluded_communities: '{excludedCommunities}', expand_targeting: false } }),
    { name: 'targeting.communities', class: 'read', requiredScopes: ['adsread'], description: 'Search targetable communities by name or topic. Use returned community names in ad-group targeting.',
      parameters: parameters({ query: text, ...page }, ['query']), request: { method: 'GET', path: '/targeting/communities/search', query: { query: '{query}', ...pageQuery } } },
    { name: 'targeting.geolocations', class: 'read', requiredScopes: ['adsread'], description: 'Find country or city geolocation IDs for targeting.',
      parameters: parameters({ country: { type: 'string', pattern: '^[A-Z]{2}$' }, city: text }, ['country']),
      request: { method: 'GET', path: '/targeting/geolocations', query: { country: '{country}', cities_search: '{city}' } } },
    write('posts.createImage', 'Submit a structured image-post creation job using provider-fetchable public HTTPS media. A committed result means job submission; poll posts.getJob until SUCCESS and use its resulting post ID.', '/profiles/{profileId}/structured_posts/jobs',
      { profileId: id, headline: { type: 'string', minLength: 1, maxLength: 300 }, destinationUrl: url, imageUrl: url, thumbnailUrl: url, allowComments: { type: 'boolean' } },
      ['profileId', 'headline', 'destinationUrl', 'imageUrl', 'thumbnailUrl', 'allowComments'],
      { allow_comments: '{allowComments}', creative: { type: 'IMAGE', headline: '{headline}', destination: { type: 'URL', url: '{destinationUrl}' }, image: { media: { type: 'URL', url: '{imageUrl}' } }, thumbnail: { media: { type: 'URL', url: '{thumbnailUrl}' } } } }),
    write('posts.createText', 'Submit a structured free-form text-post creation job. Poll posts.getJob before treating the creative as available.', '/profiles/{profileId}/structured_posts/jobs',
      { profileId: id, headline: { type: 'string', minLength: 1, maxLength: 300 }, body: { type: 'string', minLength: 1, maxLength: 40000 }, allowComments: { type: 'boolean' } },
      ['profileId', 'headline', 'body', 'allowComments'], { allow_comments: '{allowComments}', creative: { type: 'TEXT', headline: '{headline}', body: '{body}', text_format: 'PLAIN_TEXT' } }),
    { name: 'posts.getJob', class: 'read', requiredScopes: ['adsread'], description: 'Read creative job status and output. PROCESSING/QUEUED are unfinished; CLIENT_ERROR/SERVER_ERROR are failures, not created ads.',
      parameters: parameters({ jobId: id }, ['jobId']), request: { method: 'GET', path: '/structured_posts/jobs/{jobId}' } },
    write('ads.create', 'Create a PAUSED ad with an existing successful post and HTTPS landing URL. For image ads, clickUrl must match the post destination.', `${account}/ads`,
      { accountId: id, adGroupId: id, name: text, postId: { type: 'string', pattern: '^t3_[a-zA-Z0-9]+$' }, clickUrl: url }, ['accountId', 'adGroupId', 'name', 'postId', 'clickUrl'],
      { ad_group_id: '{adGroupId}', name: '{name}', post_id: '{postId}', click_url: '{clickUrl}', configured_status: 'PAUSED' }),
    { name: 'reports.get', class: 'read', requiredScopes: ['adsread'], description: 'Read daily campaign spend, impressions, clicks and configured conversion metrics. Spend is microcurrency; conversion values are cents. Reporting may take six hours to stabilize.',
      parameters: parameters({ accountId: id, startTime: time, endTime: time, fields: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', enum: ['SPEND', 'IMPRESSIONS', 'CLICKS', 'CTR', 'CPC', 'CURRENCY', 'CONVERSION_PAGE_VISIT_CLICKS', 'CONVERSION_SIGN_UP_CLICKS', 'CONVERSION_LEAD_CLICKS', 'CONVERSION_PURCHASE_CLICKS', 'CONVERSION_PURCHASE_TOTAL_VALUE'] } } }, ['accountId', 'startTime', 'endTime', 'fields']),
      request: { method: 'POST', path: `${account}/reports`, body: { data: { starts_at: '{startTime}', ends_at: '{endTime}', fields: '{fields}', breakdowns: ['CAMPAIGN_ID', 'DATE'] } } } },
  ],
})

export const redditAdsConnector = {
  ...base,
  async executeMutation(inv: Parameters<NonNullable<typeof base.executeMutation>>[0]) {
    if (inv.args.totalBudgetMicros !== undefined && !(typeof inv.args.totalBudgetMicros === 'number' && Number.isSafeInteger(inv.args.totalBudgetMicros) && Number(inv.args.totalBudgetMicros) > 0)) throw new Error('reddit-ads: totalBudgetMicros must be positive safe integer microcurrency')
    if (inv.capabilityName === 'campaigns.createTraffic' || inv.capabilityName === 'adGroups.createTraffic') {
      if (!(typeof inv.args.startTime === 'string' && typeof inv.args.endTime === 'string' && Date.parse(inv.args.endTime) > Date.parse(inv.args.startTime))) throw new Error('reddit-ads: endTime must be after startTime')
    }
    return base.executeMutation!(inv)
  },
}
