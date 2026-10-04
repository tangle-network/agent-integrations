import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'
import { isPlainRecord } from './file-payload.js'

const id = { type: 'string', pattern: '^[a-zA-Z0-9]+$' }
const text = { type: 'string', minLength: 1, maxLength: 255 }
const micros = { type: 'string', pattern: '^[1-9][0-9]*$', description: 'Positive integer microcurrency in the funding instrument currency; 1000000 = one currency unit.' }
const time = { type: 'string', format: 'date-time' }
const page = { cursor: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 1000 } }
const accountPath = '/accounts/{accountId}'
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}
function write(name: string, description: string, path: string, properties: Record<string, unknown>, required: string[], body: Record<string, unknown>, method: 'POST' | 'PUT' = 'POST'): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true,
    parameters: parameters({ accountId: id, ...properties }, ['accountId', ...required]),
    request: { method, path: accountPath + path, bodyEncoding: 'form', body } }
}

const base = declarativeRestConnector({
  kind: 'x-ads', displayName: 'X Ads',
  description: 'Manage X paid campaigns with total budgets, scheduled line items, targeting, promoted posts, and spend reports.',
  auth: { kind: 'api-key', hint: 'JSON OAuth 1.0a credential bundle: consumerKey, consumerSecret, accessToken, accessTokenSecret. Requires an Ads API approved application and advertiser user access. Twitter OAuth 2.0 tokens do not work.' },
  credentialPlacement: { kind: 'oauth1' },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://ads-api.x.com/12',
  credentialsExpiredStatuses: [401], test: { method: 'GET', path: '/accounts', query: { count: 1 } },
  capabilities: [
    { name: 'accounts.list', class: 'read', description: 'Discover accessible advertising accounts, approval status and timezone. Follow next_cursor.', parameters: parameters(page),
      request: { method: 'GET', path: '/accounts', query: { count: '{count}', cursor: '{cursor}' } } },
    ...(['funding_instruments', 'campaigns', 'line_items', 'promoted_tweets', 'promotable_users', 'authenticated_user_access'] as const).map(resource => ({
      name: ({ funding_instruments: 'fundingInstruments.list', campaigns: 'campaigns.list', line_items: 'lineItems.list', promoted_tweets: 'ads.list', promotable_users: 'accounts.promotableUsers', authenticated_user_access: 'accounts.authenticatedUserAccess' })[resource],
      class: 'read' as const, description: `Read ${resource} with native IDs, status, budget and pagination. Funding instruments include currency and funding readiness.`,
      parameters: parameters({ accountId: id, ...page }, ['accountId']),
      request: { method: 'GET' as const, path: `${accountPath}/${resource}`, query: { count: '{count}', cursor: '{cursor}' } },
    })),
    { name: 'campaigns.get', class: 'read', description: 'Read the campaign budget and status before launch and after changes.',
      parameters: parameters({ accountId: id, campaignId: id }, ['accountId', 'campaignId']),
      request: { method: 'GET', path: `${accountPath}/campaigns/{campaignId}` } },
    write('campaigns.create', 'Create a PAUSED campaign with a required total budget. Verify currency and funding first. Line items own the serving schedule.', '/campaigns',
      { name: text, fundingInstrumentId: id, totalBudgetMicros: micros, dailyBudgetMicros: micros },
      ['name', 'fundingInstrumentId', 'totalBudgetMicros', 'dailyBudgetMicros'],
      { name: '{name}', funding_instrument_id: '{fundingInstrumentId}', total_budget_amount_local_micro: '{totalBudgetMicros}', daily_budget_amount_local_micro: '{dailyBudgetMicros}', budget_optimization: 'LINE_ITEM', entity_status: 'PAUSED' }),
    write('campaigns.enable', 'Launch a campaign under an explicit cumulative total budget and daily budget. Active line items may spend immediately. Verify all line-item schedules, targeting, creative review and authorization first.', '/campaigns/{campaignId}',
      { campaignId: id, totalBudgetMicros: micros, dailyBudgetMicros: micros }, ['campaignId', 'totalBudgetMicros', 'dailyBudgetMicros'],
      { entity_status: 'ACTIVE', total_budget_amount_local_micro: '{totalBudgetMicros}', daily_budget_amount_local_micro: '{dailyBudgetMicros}' }, 'PUT'),
    write('campaigns.pause', 'Pause the campaign. Read back status and reporting; billing metrics can lag.', '/campaigns/{campaignId}',
      { campaignId: id }, ['campaignId'], { entity_status: 'PAUSED' }, 'PUT'),
    write('lineItems.createTraffic', 'Create a PAUSED website-clicks line item with a fixed schedule, total budget and maximum CPC bid. The parent campaign budget also constrains spend.', '/line_items',
      { campaignId: id, name: text, startTime: time, endTime: time, totalBudgetMicros: micros, bidMicros: micros },
      ['campaignId', 'name', 'startTime', 'endTime', 'totalBudgetMicros', 'bidMicros'],
      { campaign_id: '{campaignId}', name: '{name}', start_time: '{startTime}', end_time: '{endTime}', total_budget_amount_local_micro: '{totalBudgetMicros}', bid_amount_local_micro: '{bidMicros}',
        product_type: 'PROMOTED_TWEETS', objective: 'WEBSITE_CLICKS', placements: 'ALL_ON_TWITTER', goal: 'LINK_CLICKS', bid_strategy: 'MAX', standard_delivery: true, entity_status: 'PAUSED' }),
    ...(['ACTIVE', 'PAUSED'] as const).map(status => write(status === 'ACTIVE' ? 'lineItems.enable' : 'lineItems.pause',
      status === 'ACTIVE' ? 'Enable a line item; can spend immediately if the campaign is active. Confirm its native total budget and fixed schedule first.' : 'Pause a line item.',
      '/line_items/{lineItemId}', { lineItemId: id }, ['lineItemId'], { entity_status: status }, 'PUT')),
    { name: 'targeting.locations', class: 'read', description: 'Find geographic targeting IDs. Use returned targeting_value in targeting.add.',
      parameters: parameters({ query: text, locationType: { type: 'string', enum: ['COUNTRIES', 'REGIONS', 'METROS', 'CITIES', 'POSTAL_CODES'] } }, ['query']),
      request: { method: 'GET', path: '/targeting_criteria/locations', query: { q: '{query}', location_type: '{locationType}' } } },
    write('targeting.add', 'Add a location, keyword, language, or follower targeting criterion to a line item. Use discovered native values.', '/targeting_criteria',
      { lineItemId: id, targetingType: { type: 'string', enum: ['LOCATION', 'PHRASE_KEYWORD', 'EXACT_KEYWORD', 'BROAD_KEYWORD', 'LANGUAGE', 'FOLLOWERS_OF_USER'] }, targetingValue: { type: 'string', minLength: 1 } },
      ['lineItemId', 'targetingType', 'targetingValue'], { line_item_id: '{lineItemId}', targeting_type: '{targetingType}', targeting_value: '{targetingValue}' }),
    write('posts.createPromotedOnly', 'Create a promoted-only post with text and an optional pre-uploaded card or media. It does not appear on the organic timeline; attach it to a paused line item next.', '/tweet',
      { advertiserUserId: { type: 'string', pattern: '^[0-9]+$', description: 'Promotable advertiser user ID from accounts.promotableUsers. The connected user needs TWEET_COMPOSER permission.' }, text: { type: 'string', minLength: 1, maxLength: 280 }, cardUri: { type: 'string' }, mediaKeys: { type: 'string', pattern: '^[0-9]+_[0-9]+(,[0-9]+_[0-9]+){0,3}$', description: 'Comma-separated media keys already uploaded for the advertiser.' } }, ['advertiserUserId', 'text'],
      { as_user_id: '{advertiserUserId}', text: '{text}', card_uri: '{cardUri}', media_keys: '{mediaKeys}', nullcast: true }),
    write('ads.promotePost', 'Attach one existing or promoted-only post to a line item. Keep the parent paused while preparing; an active line item can serve this immediately.', '/promoted_tweets',
      { lineItemId: id, tweetId: { type: 'string', pattern: '^[0-9]+$' } }, ['lineItemId', 'tweetId'], { line_item_id: '{lineItemId}', tweet_ids: '{tweetId}' }),
    { name: 'reports.stats', class: 'read', description: 'Read synchronous campaign, line-item or promoted-post spend, engagement and web conversion metrics. Use ranges of at most 7 days; billing metrics can be revised for three days.',
      parameters: parameters({ accountId: id, entity: { type: 'string', enum: ['CAMPAIGN', 'LINE_ITEM', 'PROMOTED_TWEET'] }, entityIds: { type: 'string', pattern: '^[a-zA-Z0-9]+(,[a-zA-Z0-9]+){0,19}$' }, startTime: time, endTime: time,
        granularity: { type: 'string', enum: ['TOTAL', 'DAY', 'HOUR'] } }, ['accountId', 'entity', 'entityIds', 'startTime', 'endTime', 'granularity']),
      request: { method: 'GET', path: '/stats/accounts/{accountId}', query: { entity: '{entity}', entity_ids: '{entityIds}', start_time: '{startTime}', end_time: '{endTime}', granularity: '{granularity}', placement: 'ALL_ON_TWITTER', metric_groups: 'ENGAGEMENT,BILLING,WEB_CONVERSION' } } },
  ],
})

export const xAdsConnector = {
  ...base,
  async executeMutation(inv: Parameters<NonNullable<typeof base.executeMutation>>[0]) {
    for (const key of ['totalBudgetMicros', 'dailyBudgetMicros', 'bidMicros']) {
      if (inv.args[key] !== undefined && (typeof inv.args[key] !== 'string' || !/^[1-9][0-9]*$/.test(inv.args[key]))) throw new Error(`x-ads: ${key} must be positive integer microcurrency`)
    }
    if (typeof inv.args.dailyBudgetMicros === 'string' && typeof inv.args.totalBudgetMicros === 'string' && BigInt(inv.args.dailyBudgetMicros) > BigInt(inv.args.totalBudgetMicros)) throw new Error('x-ads: daily budget exceeds total budget')
    if (inv.capabilityName === 'lineItems.createTraffic' && !(typeof inv.args.startTime === 'string' && typeof inv.args.endTime === 'string' && Date.parse(inv.args.endTime) > Date.parse(inv.args.startTime))) throw new Error('x-ads: endTime must be after startTime')
    const result = await base.executeMutation!(inv)
    if (result.status === 'committed') {
      const envelope = result.data
      const records = isPlainRecord(envelope) ? (Array.isArray(envelope.data) ? envelope.data : [envelope.data]) : []
      if (!isPlainRecord(envelope) || envelope.errors || records.length === 0 || !records.every(item => isPlainRecord(item) &&
        ((typeof item.id === 'string' && item.id.length > 0) || (typeof item.id_str === 'string' && item.id_str.length > 0)))) {
        throw new Error('x-ads: missing native mutation receipt or provider error; reconcile state before retrying')
      }
    }
    return result
  },
}
