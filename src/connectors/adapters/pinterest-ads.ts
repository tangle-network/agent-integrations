import { declarativeRestConnector, type RestOperationSpec } from './declarative-rest.js'

const text = { type: 'string', minLength: 1 }
const id = { ...text, pattern: '^\\d+$' }
const micros = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: 'Microcurrency in the ad account currency: 1000000 = one currency unit.' }
const timestamp = { type: 'integer', minimum: 1, description: 'Unix timestamp in seconds.' }
const strings = { type: 'array', minItems: 1, items: text }
const accountPath = '/ad_accounts/{adAccountId}'
function parameters(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: { adAccountId: id, ...properties }, required: ['adAccountId', ...required], additionalProperties: false }
}
function write(name: string, description: string, resource: string, properties: Record<string, unknown>, required: string[], body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST'): RestOperationSpec {
  return { name, description, class: 'mutation', cas: 'none', externalEffect: true, requiredScopes: ['ads:write'], parameters: parameters(properties, required), request: { method, path: `${accountPath}/${resource}`, body: [body] } }
}

const operations: RestOperationSpec[] = [
  {
    name: 'accounts.list', class: 'read', description: 'List accessible ad accounts, currency, and account status. Follow bookmark for further pages.', requiredScopes: ['ads:read'],
    parameters: { type: 'object', properties: { bookmark: text }, additionalProperties: false },
    request: { method: 'GET', path: '/ad_accounts', query: { bookmark: '{bookmark}', page_size: 100 } },
  },
  ...(['campaigns', 'ad_groups', 'ads'] as const).map(resource => ({
    name: `${resource === 'ad_groups' ? 'adGroups' : resource}.list`, class: 'read' as const, requiredScopes: ['ads:read'],
    description: `List ${resource} and their provider statuses; follow bookmark for additional pages.`,
    parameters: parameters({ bookmark: text }),
    request: { method: 'GET' as const, path: `${accountPath}/${resource}`, query: { bookmark: '{bookmark}', page_size: 100 } },
  })),
  write('campaigns.createConsideration', 'Create a PAUSED consideration campaign with a lifetime campaign budget in microcurrency and a required end time. Ad groups inherit this budget; daily budgets and Performance+ are disabled.', 'campaigns',
    { name: text, lifetimeSpendCap: micros, startTime: timestamp, endTime: timestamp }, ['name', 'lifetimeSpendCap', 'startTime', 'endTime'],
    { name: '{name}', objective_type: 'CONSIDERATION', status: 'PAUSED', is_campaign_budget_optimization: true, is_flexible_daily_budgets: false, is_performance_plus: false, is_automated_campaign: false, lifetime_spend_cap: '{lifetimeSpendCap}', start_time: '{startTime}', end_time: '{endTime}' }),
  write('adGroups.create', 'Create a PAUSED clickthrough ad group inside a consideration campaign using campaign budget optimization. Explicit location targeting and a maximum CPC bid are required; automatic targeting expansion is disabled.', 'ad_groups',
    { campaignId: id, name: text, bidMicros: micros, locations: { ...strings, description: 'Pinterest LOCATION codes, such as US or CA.' }, interests: strings, locales: strings }, ['campaignId', 'name', 'bidMicros', 'locations'],
    { campaign_id: '{campaignId}', name: '{name}', status: 'PAUSED', billable_event: 'CLICKTHROUGH', bid_strategy_type: 'MAX_BID', bid_in_micro_currency: '{bidMicros}', auto_targeting_enabled: false, targeting_spec: { LOCATION: '{locations}', INTEREST: '{interests}', LOCALE: '{locales}' } }),
  write('ads.createFromPin', 'Create a PAUSED regular image ad from an existing eligible Pin. Pin creation and media upload are separate Pinterest operations; ad review still applies.', 'ads',
    { adGroupId: id, pinId: id, name: text, destinationUrl: { type: 'string', format: 'uri' } }, ['adGroupId', 'pinId', 'name', 'destinationUrl'],
    { ad_group_id: '{adGroupId}', pin_id: '{pinId}', name: '{name}', destination_url: '{destinationUrl}', creative_type: 'REGULAR', status: 'PAUSED' }),
  ...(['campaigns', 'ad_groups', 'ads'] as const).flatMap(resource => (['ACTIVE', 'PAUSED'] as const).map(status => write(
    `${resource === 'ad_groups' ? 'adGroups' : resource}.${status === 'ACTIVE' ? 'enable' : 'pause'}`,
    status === 'ACTIVE' ? 'Enable the entity. Serving can spend immediately when its parents are active; verify billing, lifetime budget, targeting and authorization first.' : 'Pause the entity, then read status and delayed spend to confirm.',
    resource, { entityId: id }, ['entityId'], { id: '{entityId}', status }, 'PATCH',
  ))),
  {
    name: 'reports.account', class: 'read', requiredScopes: ['ads:read'], description: 'Read daily account impressions, paid clicks and spend in microcurrency. Attribution and reporting lag apply; no unconfigured conversion outcomes are inferred.',
    parameters: parameters({ startDate: { type: 'string', format: 'date' }, endDate: { type: 'string', format: 'date' } }, ['startDate', 'endDate']),
    request: { method: 'GET', path: `${accountPath}/analytics`, query: { start_date: '{startDate}', end_date: '{endDate}', granularity: 'DAY', columns: 'SPEND_IN_MICRO_DOLLAR,PAID_IMPRESSION,TOTAL_CLICKTHROUGH' } },
  },
]

const rest = declarativeRestConnector({
  kind: 'pinterest-ads', displayName: 'Pinterest Ads', description: 'Manage Pinterest consideration campaigns, targeted ad groups, existing-Pin ads and spend reports.',
  auth: { kind: 'oauth2', authorizationUrl: 'https://www.pinterest.com/oauth/', tokenUrl: 'https://api.pinterest.com/v5/oauth/token', scopes: ['ads:read', 'ads:write'], clientIdEnv: 'PINTEREST_ADS_CLIENT_ID', clientSecretEnv: 'PINTEREST_ADS_CLIENT_SECRET', tokenClientAuthMethod: 'client_secret_basic' },
  category: 'other', defaultConsistencyModel: 'cache', baseUrl: 'https://api.pinterest.com/v5', credentialsExpiredStatuses: [401],
  test: { method: 'GET', path: '/ad_accounts', query: { page_size: 1 } }, capabilities: operations,
})

export const pinterestAdsConnector: typeof rest = {
  ...rest,
  async executeMutation(inv) {
    const result = await rest.executeMutation!(inv)
    if (result.status !== 'committed') return result
    const items = record(result.data)?.items
    const item = Array.isArray(items) && items.length === 1 ? record(items[0]) : undefined
    if (!item) throw new Error('pinterest-ads returned no single-item receipt; reconcile provider state before retrying')
    if (item.exceptions != null && !Array.isArray(item.exceptions)) throw new Error('pinterest-ads returned an invalid exception receipt; reconcile provider state before retrying')
    // Native batch errors can echo request data; do not expose them verbatim.
    if (Array.isArray(item.exceptions) && item.exceptions.length) throw new Error(`pinterest-ads rejected the item (${item.exceptions.length} provider exceptions); inspect account permissions and field constraints before retrying`)
    const entity = record(item.data)
    if (!entity || typeof entity.id !== 'string' || !entity.id.trim()) throw new Error('pinterest-ads returned no entity ID; reconcile provider state before retrying')
    return result
  },
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
