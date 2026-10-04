import { CredentialsExpired, type CapabilityMutationResult, type ConnectorAdapter, type ConnectorInvocation } from '../types.js'
import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import { isPlainRecord, MAX_FILE_BYTES, readBase64File } from './file-payload.js'

const scope = 'snapchat-marketing-api'
const id = { type: 'string', format: 'uuid' }
const text = { type: 'string', minLength: 1 }
const micros = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Positive micro-currency units in the ad account currency. 1000000 = one currency unit.' }
const time = { type: 'string', format: 'date-time' }
const pagination = { limit: { type: 'integer', minimum: 50, maximum: 100 }, cursor: text }
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function mutation(name: string, description: string, properties: Record<string, unknown>, required: string[], path: string, body: Record<string, unknown>): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: [scope],
    parameters: parameters(properties, required), request: { method: 'POST', path, body } }
}

const base = declarativeRestConnector({
  kind: 'snapchat-ads', displayName: 'Snapchat Ads',
  description: 'Create bounded Snapchat campaigns, targeted ad squads, uploaded media and website creatives; control delivery and read spend and conversions.',
  auth: { kind: 'oauth2', authorizationUrl: 'https://accounts.snapchat.com/login/oauth2/authorize',
    tokenUrl: 'https://accounts.snapchat.com/login/oauth2/access_token', scopes: [scope], pkce: 'unsupported',
    clientIdEnv: 'SNAPCHAT_ADS_OAUTH_CLIENT_ID', clientSecretEnv: 'SNAPCHAT_ADS_OAUTH_CLIENT_SECRET' },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://adsapi.snapchat.com/v1', credentialsExpiredStatuses: [401],
  capabilities: [
    { name: 'accounts.list', class: 'read', requiredScopes: [scope],
      description: 'Discover organizations and their ad accounts, including native IDs and account currency. Follow the returned paging cursor.', parameters: parameters(pagination),
      request: { method: 'GET', path: '/me/organizations', query: { with_ad_accounts: true, limit: '{limit}', cursor: '{cursor}' } } },
    ...(['campaigns', 'adsquads', 'ads', 'creatives', 'media'] as const).map((entity): RestOperationSpec => ({ name: `${entity}.list`, class: 'read', requiredScopes: [scope],
      description: `Read ${entity} for an ad account, including provider delivery, review or processing state. Follow paging.next_link's cursor using this same action.`,
      parameters: parameters({ accountId: id, ...pagination }, ['accountId']),
      request: { method: 'GET', path: `/adaccounts/{accountId}/${entity}`, query: { limit: '{limit}', cursor: '{cursor}' } } })),
    mutation('campaigns.createTraffic', 'Create a PAUSED auction traffic campaign with a required lifetime spend cap and fixed flight. This aggregate cap bounds all ad squads in this campaign.',
      { accountId: id, name: text, lifetimeSpendCapMicro: micros, startTime: time, endTime: time },
      ['accountId', 'name', 'lifetimeSpendCapMicro', 'startTime', 'endTime'], '/adaccounts/{accountId}/campaigns',
      { campaigns: [{ ad_account_id: '{accountId}', name: '{name}', status: 'PAUSED', buy_model: 'AUCTION',
        objective_v2_properties: { objective_v2_type: 'TRAFFIC' }, lifetime_spend_cap_micro: '{lifetimeSpendCapMicro}', start_time: '{startTime}', end_time: '{endTime}' }] }),
    mutation('adsquads.createTraffic', 'Create a PAUSED website-traffic ad squad with a lifetime budget, fixed flight, explicit countries and maximum bid. The campaign lifetime cap remains the aggregate limit.',
      { campaignId: id, name: text, lifetimeBudgetMicro: micros, bidMicro: micros, startTime: time, endTime: time,
        countries: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[a-z]{2}$' }, uniqueItems: true } },
      ['campaignId', 'name', 'lifetimeBudgetMicro', 'bidMicro', 'startTime', 'endTime', 'countries'], '/campaigns/{campaignId}/adsquads',
      { adsquads: [{ campaign_id: '{campaignId}', name: '{name}', status: 'PAUSED', type: 'SNAP_ADS',
        placement_v2: { config: 'AUTOMATIC' }, optimization_goal: 'SWIPES', bid_strategy: 'LOWEST_COST_WITH_MAX_BID',
        billing_event: 'IMPRESSION', bid_micro: '{bidMicro}', lifetime_budget_micro: '{lifetimeBudgetMicro}',
        delivery_constraint: 'LIFETIME_BUDGET', pacing_type: 'STANDARD', start_time: '{startTime}', end_time: '{endTime}', targeting: '{targeting}' }] }),
    mutation('media.create', 'Create an IMAGE or VIDEO media container. Upload bytes using media.upload and read media.list until READY before using it in a creative.',
      { accountId: id, name: text, type: { type: 'string', enum: ['IMAGE', 'VIDEO'] } }, ['accountId', 'name', 'type'], '/adaccounts/{accountId}/media',
      { media: [{ ad_account_id: '{accountId}', name: '{name}', type: '{type}' }] }),
    mutation('media.upload', 'Upload a canonical base64 image or video to a previously created media container, up to 10 MiB. Provider dimension/duration rules still apply; wait for READY. Larger uploads require Snap native chunked upload.',
      { mediaId: id, fileBase64: { ...text, maxLength: Math.ceil(MAX_FILE_BYTES / 3) * 4 }, filename: text,
        mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'] } },
      ['mediaId', 'fileBase64', 'filename', 'mimeType'], '/media/{mediaId}/upload', {}),
    mutation('creatives.createWebsite', 'Create a WEB_VIEW creative from READY media, a public profile, headline and HTTPS destination. Read review_status before serving.',
      { accountId: id, name: text, mediaId: id, profileId: id, headline: { ...text, maxLength: 34 }, brandName: { ...text, maxLength: 32 },
        url: { type: 'string', format: 'uri', pattern: '^https://' }, callToAction: { type: 'string', enum: ['MORE', 'SIGN_UP', 'SHOP_NOW', 'BOOK_NOW', 'TRY', 'APPLY_NOW', 'DOWNLOAD'] } },
      ['accountId', 'name', 'mediaId', 'profileId', 'headline', 'url', 'callToAction'], '/adaccounts/{accountId}/creatives',
      { creatives: [{ ad_account_id: '{accountId}', name: '{name}', type: 'WEB_VIEW', top_snap_media_id: '{mediaId}',
        headline: '{headline}', brand_name: '{brandName}', profile_properties: { profile_id: '{profileId}' },
        web_view_properties: { url: '{url}' }, call_to_action: '{callToAction}' }] }),
    mutation('ads.create', 'Create a PAUSED ad linking a reviewed website creative to an ad squad.',
      { adSquadId: id, creativeId: id, name: text }, ['adSquadId', 'creativeId', 'name'], '/adsquads/{adSquadId}/ads',
      { ads: [{ ad_squad_id: '{adSquadId}', creative_id: '{creativeId}', name: '{name}', type: 'REMOTE_WEBPAGE', status: 'PAUSED' }] }),
    ...([
      ['campaigns', '/adaccounts/{accountId}/campaigns/{objectId}', 'accountId'],
      ['adsquads', '/campaigns/{campaignId}/adsquads/{objectId}', 'campaignId'],
      ['ads', '/adsquads/{adSquadId}/ads/{objectId}', 'adSquadId'],
    ] as const).flatMap(([entity, path, parent]) => (['ACTIVE', 'PAUSED'] as const).map((status): RestOperationSpec => ({
      name: `${entity}.${status === 'ACTIVE' ? 'enable' : 'pause'}`, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: [scope],
      description: status === 'ACTIVE' ? 'Enable delivery using a status-only PATCH. Verify spend authorization, campaign cap, billing, targeting, flight and review first; active ancestors can spend immediately.' : 'Pause delivery with a status-only PATCH; retain all budgets, targeting and creatives.',
      parameters: parameters({ [parent]: id, objectId: id }, [parent, 'objectId']),
      request: { method: 'PATCH', path, headers: { 'content-type': 'application/json-patch+json' }, body: '{statusPatch}' },
    }))),
    { name: 'reports.campaign', class: 'read', requiredScopes: [scope],
      description: 'Read campaign spend, impressions, swipes and configured purchases/signup attribution for a fixed time range. Spend is micro-currency; stats are delayed and may be revised.',
      parameters: parameters({ campaignId: id, startTime: time, endTime: time, granularity: { type: 'string', enum: ['TOTAL', 'DAY', 'HOUR'] } }, ['campaignId', 'startTime', 'endTime', 'granularity']),
      request: { method: 'GET', path: '/campaigns/{campaignId}/stats', query: { granularity: '{granularity}', start_time: '{startTime}', end_time: '{endTime}',
        fields: 'impressions,swipes,spend,conversion_purchases,conversion_sign_ups' } } },
  ],
})

function assertEnvelope(value: unknown): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value) || typeof value.request_status !== 'string') throw new Error('snapchat-ads: malformed provider response (missing request_status)')
  if (value.request_status.toUpperCase() !== 'SUCCESS') throw new Error('snapchat-ads: provider rejected request')
  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (isPlainRecord(entry) && typeof entry.sub_request_status === 'string' && entry.sub_request_status.toUpperCase() !== 'SUCCESS') {
        throw new Error('snapchat-ads: provider rejected a sub-request; inspect native status before retrying')
      }
    }
  }
}

function assertMutationReceipt(value: unknown, capability: string): void {
  assertEnvelope(value)
  let entity: unknown
  if (capability === 'media.upload') {
    // The upload endpoint returns result.id, unlike media creation's batch.
    // https://developers.snap.com/marketing-api/Ads-API/media
    entity = value.result
  } else {
    const resource = capability.split('.')[0]!
    const entities = value[resource]
    const receipt = Array.isArray(entities) && entities.length === 1 ? entities[0] : undefined
    if (!isPlainRecord(receipt) || typeof receipt.sub_request_status !== 'string' || receipt.sub_request_status.toUpperCase() !== 'SUCCESS') {
      throw new Error('snapchat-ads: missing successful entity sub-request; reconcile provider state before retrying')
    }
    entity = receipt[resource === 'media' ? 'media' : resource.slice(0, -1)]
  }
  if (!isPlainRecord(entity) || typeof entity.id !== 'string' || !entity.id.trim()) {
    throw new Error('snapchat-ads: missing native entity ID in mutation receipt; reconcile provider state before retrying')
  }
}

function prepare(inv: ConnectorInvocation): ConnectorInvocation {
  const a = inv.args
  if (inv.capabilityName.endsWith('.createTraffic')) {
    for (const key of inv.capabilityName === 'campaigns.createTraffic' ? ['lifetimeSpendCapMicro'] : ['lifetimeBudgetMicro', 'bidMicro']) {
      if (!Number.isSafeInteger(a[key]) || Number(a[key]) <= 0) throw new Error(`snapchat-ads: ${key} must be a positive safe integer`)
    }
    if (!(Date.parse(String(a.endTime)) > Date.parse(String(a.startTime)))) throw new Error('snapchat-ads: endTime must be after startTime')
  }
  return { ...inv, args: { ...a, targeting: { geos: Array.isArray(a.countries) ? a.countries.map(country_code => ({ country_code })) : undefined },
    statusPatch: [{ op: 'replace', path: '/status', value: inv.capabilityName.endsWith('.enable') ? 'ACTIVE' : 'PAUSED' }] } }
}

async function upload(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
  const credentials = inv.source.credentials
  if (credentials.kind !== 'oauth2') throw new Error('snapchat-ads: OAuth credentials required')
  const { mediaId, filename, mimeType } = inv.args
  if (typeof mediaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(mediaId)) throw new Error('snapchat-ads: mediaId must be a UUID')
  if (typeof filename !== 'string' || !filename || typeof mimeType !== 'string' || !['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime'].includes(mimeType)) throw new Error('snapchat-ads: filename and supported mimeType are required')
  const bytes = readBase64File(inv.args.fileBase64)
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename)
  const response = await fetch(`https://adsapi.snapchat.com/v1/media/${encodeURIComponent(mediaId)}/upload`, {
    method: 'POST', headers: { authorization: `Bearer ${credentials.accessToken}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 401) throw new CredentialsExpired('Snapchat Ads rejected credentials (401)', inv.source.id)
  if (response.status === 429) return { status: 'rate-limited', retryAfterMs: 60_000, message: 'Snapchat Ads upload rate limited' }
  if (!response.ok) throw new Error(`snapchat-ads: media upload HTTP ${response.status}`)
  const data: unknown = await response.json().catch(() => null)
  assertMutationReceipt(data, inv.capabilityName)
  return { status: 'committed', data, committedAt: Date.now(), idempotentReplay: false }
}

export const snapchatAdsConnector: ConnectorAdapter = {
  ...base,
  async executeRead(inv) { const result = await base.executeRead!(prepare(inv)); assertEnvelope(result.data); return result },
  async executeMutation(inv) {
    if (inv.capabilityName === 'media.upload') return upload(inv)
    const result = await base.executeMutation!(prepare(inv))
    if (result.status === 'committed') assertMutationReceipt(result.data, inv.capabilityName)
    return result
  },
  async test(source) {
    try {
      const result = await base.executeRead!({ source, capabilityName: 'accounts.list', args: {}, idempotencyKey: 'test' })
      assertEnvelope(result.data)
      return { ok: true }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Snapchat Ads connection failed' } }
  },
}
