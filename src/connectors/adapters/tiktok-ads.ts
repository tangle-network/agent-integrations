import { CredentialsExpired, ProviderRateLimited, type CapabilityMutationResult, type ConnectorAdapter, type ConnectorCredentials, type ConnectorInvocation } from '../types.js'
import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import { isPlainRecord } from './file-payload.js'

const id = { type: 'string', pattern: '^[0-9]+$' }
const text = { type: 'string', minLength: 1 }
const budget = { type: 'number', exclusiveMinimum: 0, description: 'Total budget in advertiser currency units, not cents or micros. TikTok minimums depend on currency and flight length.' }
const time = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$', description: 'yyyy-MM-dd HH:mm:ss in the advertiser timezone.' }
const ids = { type: 'array', minItems: 1, maxItems: 100, items: id }
const pagination = { page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 } }
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function mutation(name: string, description: string, properties: Record<string, unknown>, required: string[], path: string, body: Record<string, unknown>): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true,
    parameters: parameters({ advertiserId: id, ...properties }, ['advertiserId', ...required]),
    request: { method: 'POST', path, body: { advertiser_id: '{advertiserId}', ...body } } }
}

const base = declarativeRestConnector({
  kind: 'tiktok-ads', displayName: 'TikTok Ads',
  description: 'Operate TikTok Marketing API traffic campaigns, lifetime budgets, targeted ad groups, video ads and paid performance reports.',
  auth: { kind: 'api-key', hint: 'JSON secret bundle with accessToken, appId and appSecret from your approved TikTok API for Business app. This is separate from TikTok creator OAuth. Keep all three in this secret field.' },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://business-api.tiktok.com/open_api/v1.3',
  credentialPlacement: { kind: 'structured-headers', fields: { accessToken: 'Access-Token' } }, credentialsExpiredStatuses: [401],
  capabilities: [
    { name: 'advertisers.list', class: 'read', description: 'Discover advertisers that granted this Business API app access. Uses app credentials only from the encrypted connection secret.',
      parameters: parameters({}), request: { method: 'GET', path: '/oauth2/advertiser/get/' } },
    { name: 'advertisers.get', class: 'read', description: 'Read advertiser currency, timezone and account details before choosing budgets or schedules.',
      parameters: parameters({ advertiserIds: ids }, ['advertiserIds']),
      request: { method: 'GET', path: '/advertiser/info/', query: { advertiser_ids: '{advertiserIdsJson}' } } },
    ...(['campaign', 'adgroup', 'ad'] as const).map((entity): RestOperationSpec => ({ name: `${entity}s.list`, class: 'read',
      description: `Read ${entity} IDs, provider status and setup. Follow page_info; filters are deliberately bounded to a single optional native ID.`,
      parameters: parameters({ advertiserId: id, objectId: id, ...pagination }, ['advertiserId']),
      request: { method: 'GET', path: `/${entity}/get/`, query: { advertiser_id: '{advertiserId}', filtering: '{filteringJson}', page: '{page}', page_size: '{pageSize}' } } })),
    { name: 'identities.list', class: 'read', description: 'Discover authorized advertiser identities for video creatives. A Business Center identity additionally needs identityAuthorizedBcId.',
      parameters: parameters({ advertiserId: id, identityType: { type: 'string', enum: ['CUSTOMIZED_USER', 'AUTH_CODE', 'TT_USER', 'BC_AUTH_TT'] }, identityAuthorizedBcId: id, ...pagination }, ['advertiserId']),
      request: { method: 'GET', path: '/identity/get/', query: { advertiser_id: '{advertiserId}', identity_type: '{identityType}', identity_authorized_bc_id: '{identityAuthorizedBcId}', page: '{page}', page_size: '{pageSize}' } } },
    { name: 'targeting.locations', class: 'read', description: 'Discover location IDs available for this advertiser before creating an ad group.',
      parameters: parameters({ advertiserId: id }, ['advertiserId']),
      request: { method: 'GET', path: '/search/region/', query: { advertiser_id: '{advertiserId}' } } },
    { name: 'videos.list', class: 'read', description: 'Read available advertiser video assets and their provider video IDs. Follow page_info.',
      parameters: parameters({ advertiserId: id, ...pagination }, ['advertiserId']),
      request: { method: 'GET', path: '/file/video/ad/search/', query: { advertiser_id: '{advertiserId}', page: '{page}', page_size: '{pageSize}' } } },
    mutation('videos.uploadFromUrl', 'Ask TikTok to import a video from a public HTTPS URL into the advertiser Asset Library. Check videos.list for processing/availability before creating an ad.',
      { filename: text, videoUrl: { type: 'string', format: 'uri', pattern: '^https://' } }, ['filename', 'videoUrl'], '/file/video/ad/upload/', {}),
    mutation('campaigns.createTraffic', 'Create a DISABLED traffic campaign with a total (lifetime) budget. No automatic budget increase. Verify provider minimums and account currency before creation.',
      { name: text, totalBudget: budget }, ['name', 'totalBudget'], '/campaign/create/',
      { campaign_name: '{name}', objective_type: 'TRAFFIC', budget_mode: 'BUDGET_MODE_TOTAL', budget: '{totalBudget}', operation_status: 'DISABLE', budget_optimize_on: false }),
    mutation('adgroups.createTraffic', 'Create a DISABLED website-traffic ad group using a fixed lifetime budget, start/end, approved location IDs and TikTok placement. Keep its parent campaign disabled until review.',
      { campaignId: id, name: text, totalBudget: budget, startTime: time, endTime: time, locationIds: ids,
        bidPrice: { type: 'number', exclusiveMinimum: 0, description: 'Maximum CPC bid in advertiser currency units.' } },
      ['campaignId', 'name', 'totalBudget', 'startTime', 'endTime', 'locationIds', 'bidPrice'], '/adgroup/create/',
      { campaign_id: '{campaignId}', adgroup_name: '{name}', operation_status: 'DISABLE', promotion_type: 'WEBSITE',
        placement_type: 'PLACEMENT_TYPE_NORMAL', placements: ['PLACEMENT_TIKTOK'], location_ids: '{locationIds}',
        budget_mode: 'BUDGET_MODE_TOTAL', budget: '{totalBudget}', schedule_type: 'SCHEDULE_START_END',
        schedule_start_time: '{startTime}', schedule_end_time: '{endTime}', optimization_goal: 'CLICK', billing_event: 'CPC',
        bid_type: 'BID_TYPE_CUSTOM', bid_price: '{bidPrice}', pacing: 'PACING_MODE_SMOOTH' }),
    mutation('ads.createVideo', 'Create one DISABLED video ad from an existing advertiser video asset and authorized identity. Import media with videos.uploadFromUrl first; review and active ancestors are required to serve.',
      { adgroupId: id, name: text, adText: { ...text, maxLength: 100 }, videoId: text, identityId: text,
        identityType: { type: 'string', enum: ['CUSTOMIZED_USER', 'AUTH_CODE', 'TT_USER', 'BC_AUTH_TT'] }, identityAuthorizedBcId: id,
        landingPageUrl: { type: 'string', format: 'uri', pattern: '^https://' },
        callToAction: { type: 'string', enum: ['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'CONTACT_US', 'DOWNLOAD', 'BOOK_NOW', 'APPLY_NOW'] } },
      ['adgroupId', 'name', 'adText', 'videoId', 'identityId', 'identityType', 'landingPageUrl', 'callToAction'], '/ad/create/',
      { adgroup_id: '{adgroupId}', creatives: [{ ad_name: '{name}', ad_text: '{adText}', ad_format: 'SINGLE_VIDEO', video_id: '{videoId}',
        identity_id: '{identityId}', identity_type: '{identityType}', identity_authorized_bc_id: '{identityAuthorizedBcId}',
        landing_page_url: '{landingPageUrl}', call_to_action: '{callToAction}', operation_status: 'DISABLE' }] }),
    ...(['campaign', 'adgroup', 'ad'] as const).flatMap(entity => (['ENABLE', 'DISABLE'] as const).map(status => mutation(
      `${entity}s.${status === 'ENABLE' ? 'enable' : 'pause'}`,
      status === 'ENABLE' ? 'Enable delivery after checking approval, billing, review, targeting, total budget and flight. This can immediately spend within active ancestors.' : 'Disable delivery without changing the budget. Re-read status and report after stopping.',
      { objectId: id }, ['objectId'], `/${entity}/status/update/`, { [`${entity}_ids`]: ['{objectId}'], operation_status: status }))),
    { name: 'reports.integrated', class: 'read', description: 'Read paginated BASIC campaign, ad-group or ad performance with spend, clicks and configured conversion metrics. Amounts use advertiser currency; attributed conversions are not confirmed revenue.',
      parameters: parameters({ advertiserId: id, dataLevel: { type: 'string', enum: ['AUCTION_CAMPAIGN', 'AUCTION_ADGROUP', 'AUCTION_AD'] },
        startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' },
        metrics: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', enum: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'conversion', 'cost_per_conversion', 'conversion_rate'] } }, ...pagination },
      ['advertiserId', 'dataLevel', 'startDate', 'endDate', 'metrics']),
      request: { method: 'GET', path: '/report/integrated/get/', query: { advertiser_id: '{advertiserId}', report_type: 'BASIC', data_level: '{dataLevel}',
        dimensions: '{dimensionsJson}', metrics: '{metricsJson}', start_date: '{startDate}', end_date: '{endDate}', page: '{page}', page_size: '{pageSize}' } } },
  ],
})

function prepare(inv: ConnectorInvocation): ConnectorInvocation {
  const a = inv.args
  if (inv.capabilityName.endsWith('.createTraffic')) {
    if (typeof a.totalBudget !== 'number' || !Number.isFinite(a.totalBudget) || a.totalBudget <= 0) throw new Error('tiktok-ads: totalBudget must be positive and finite')
    if (inv.capabilityName === 'adgroups.createTraffic' && !(String(a.endTime) > String(a.startTime))) throw new Error('tiktok-ads: endTime must be after startTime')
  }
  if (inv.capabilityName === 'ads.createVideo' && a.identityType === 'BC_AUTH_TT' && !a.identityAuthorizedBcId) throw new Error('tiktok-ads: Business Center identity requires identityAuthorizedBcId')
  const entity = inv.capabilityName.split('.')[0]!.replace(/s$/, '')
  const dimension = a.dataLevel === 'AUCTION_CAMPAIGN' ? 'campaign_id' : a.dataLevel === 'AUCTION_ADGROUP' ? 'adgroup_id' : 'ad_id'
  return { ...inv, args: { ...a, advertiserIdsJson: JSON.stringify(a.advertiserIds), metricsJson: JSON.stringify(a.metrics),
    dimensionsJson: JSON.stringify([dimension]), filteringJson: a.objectId ? JSON.stringify({ [`${entity}_ids`]: [a.objectId] }) : undefined } }
}

function assertEnvelope(value: unknown, allowArrayData = false): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value) || typeof value.code !== 'number') throw new Error('tiktok-ads: malformed provider response (missing numeric code)')
  // Native errors commonly arrive with HTTP 200. Do not echo provider messages:
  // validation errors can include values from the private credential request.
  if (value.code !== 0) throw new Error(`tiktok-ads: provider rejected request (code ${value.code})`)
  if (!isPlainRecord(value.data) && !(allowArrayData && Array.isArray(value.data) && value.data.every(isPlainRecord))) throw new Error('tiktok-ads: malformed provider response (missing data)')
}

function credentials(value: ConnectorCredentials): { accessToken: string; appId: string; appSecret: string } {
  let data: unknown = value.kind === 'custom' ? value.values : undefined
  if (value.kind === 'api-key') {
    try { data = JSON.parse(value.apiKey) } catch { throw new Error('tiktok-ads: connection secret must be a JSON bundle') }
  }
  if (!isPlainRecord(data) || !['accessToken', 'appId', 'appSecret'].every(key => typeof data[key] === 'string' && data[key].length > 0)) {
    throw new Error('tiktok-ads: connection secret requires accessToken, appId and appSecret')
  }
  return { accessToken: String(data.accessToken), appId: String(data.appId), appSecret: String(data.appSecret) }
}

async function discover(inv: ConnectorInvocation) {
  const secret = credentials(inv.source.credentials)
  const endpoint = new URL('https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/')
  endpoint.searchParams.set('app_id', secret.appId)
  endpoint.searchParams.set('secret', secret.appSecret)
  const response = await fetch(endpoint, { headers: { 'Access-Token': secret.accessToken }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    .catch(() => { throw new Error('tiktok-ads: advertiser discovery transport failed') })
  if (response.status === 401) throw new CredentialsExpired('TikTok Ads rejected credentials (401)', inv.source.id)
  if (response.status === 429) throw new ProviderRateLimited('TikTok Ads advertiser discovery rate limited', inv.source.id, { status: 429, retryAfterMs: 60_000 })
  if (!response.ok) throw new Error(`tiktok-ads: advertiser discovery HTTP ${response.status}`)
  const data: unknown = await response.json().catch(() => null)
  assertEnvelope(data)
  return { data, fetchedAt: Date.now() }
}

async function uploadVideo(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
  const secret = credentials(inv.source.credentials)
  const { advertiserId, filename, videoUrl } = inv.args
  if (typeof advertiserId !== 'string' || !/^[0-9]+$/.test(advertiserId) || typeof filename !== 'string' || !filename) throw new Error('tiktok-ads: advertiserId and filename are required')
  let url: URL
  try { url = new URL(String(videoUrl)) } catch { throw new Error('tiktok-ads: videoUrl must be a public HTTPS URL') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('tiktok-ads: videoUrl must be a public HTTPS URL without credentials')
  const form = new FormData()
  form.set('advertiser_id', advertiserId)
  form.set('file_name', filename)
  form.set('upload_type', 'UPLOAD_BY_URL')
  form.set('video_url', url.href)
  const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/file/video/ad/upload/', {
    method: 'POST', headers: { 'Access-Token': secret.accessToken }, body: form, redirect: 'error', signal: AbortSignal.timeout(30_000),
  }).catch(() => { throw new Error('tiktok-ads: video upload transport failed') })
  if (response.status === 401) throw new CredentialsExpired('TikTok Ads rejected credentials (401)', inv.source.id)
  if (response.status === 429) return { status: 'rate-limited', retryAfterMs: 60_000, message: 'TikTok Ads video upload rate limited' }
  if (!response.ok) throw new Error(`tiktok-ads: video upload HTTP ${response.status}`)
  const data: unknown = await response.json().catch(() => null)
  assertEnvelope(data, true)
  return { status: 'committed', data, committedAt: Date.now(), idempotentReplay: false }
}

export const tiktokAdsConnector: ConnectorAdapter = {
  ...base,
  async executeRead(inv) {
    if (inv.capabilityName === 'advertisers.list') return discover(inv)
    credentials(inv.source.credentials)
    const result = await base.executeRead!(prepare(inv))
    assertEnvelope(result.data)
    return result
  },
  async executeMutation(inv) {
    if (inv.capabilityName === 'videos.uploadFromUrl') return uploadVideo(inv)
    credentials(inv.source.credentials)
    const result = await base.executeMutation!(prepare(inv))
    if (result.status === 'committed') assertEnvelope(result.data)
    return result
  },
  async test(source) {
    try { await discover({ source, capabilityName: 'advertisers.list', args: {}, idempotencyKey: 'test' }); return { ok: true } }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'TikTok Ads connection failed' } }
  },
}
