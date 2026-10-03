import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/adapter-provider.js'
import { googleAdsConnector } from '../src/connectors/adapters/google-ads.js'
import { type ConnectorInvocation, CredentialsExpired, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'ads-connection', projectId: 'project', publishedAgentId: null,
  kind: 'google-ads', label: 'Ads', consistencyModel: 'cache',
  scopes: ['https://www.googleapis.com/auth/adwords'], metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'private-oauth-token' }, status: 'active',
}
const campaignArgs = {
  customerId: '1234567890', name: 'Trial', totalAmountMicros: '100000000',
  startDateTime: '2026-10-05 00:00:00', endDateTime: '2026-10-08 23:59:59',
  containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
}
function invocation(capabilityName: string, args: Record<string, unknown>): ConnectorInvocation {
  return { source, capabilityName, args, idempotencyKey: 'one-logical-request' }
}
function transport(data: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  }))
}
afterEach(() => vi.restoreAllMocks())

describe('Google Ads provider contract', () => {
  it('discovers accounts with protected OAuth, then reads paginated metrics through a manager', async () => {
    const fetch = transport({ resourceNames: ['customers/1234567890'] })
    expect((await googleAdsConnector.executeRead!(invocation('customers.listAccessible', {}))).data)
      .toEqual({ resourceNames: ['customers/1234567890'] })
    expect(String(fetch.mock.calls[0]![0])).toBe('https://googleads.googleapis.com/v25/customers:listAccessibleCustomers')
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({ authorization: 'Bearer private-oauth-token' })
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('developer-token')
    fetch.mockResolvedValue(new Response(JSON.stringify({ results: [], nextPageToken: 'next' })))
    const query = 'SELECT campaign.id, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS'
    const result = await googleAdsConnector.executeRead!(invocation('reports.search', {
      customerId: '1234567890', loginCustomerId: '9988776655', query, pageToken: 'previous',
    }))
    expect(result.data).toEqual({ results: [], nextPageToken: 'next' })
    expect(fetch.mock.calls[1]![1]?.headers).toMatchObject({ 'login-customer-id': '9988776655' })
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toEqual({ query, pageToken: 'previous' })
  })

  it('creates a paused campaign and hard total budget atomically, ignoring injected daily-budget or status fields', async () => {
    const fetch = transport({ mutateOperationResponses: [{ campaignResult: { resourceName: 'customers/1234567890/campaigns/42' } }] })
    const result = await googleAdsConnector.executeMutation!(invocation('campaigns.createSearch', {
      ...campaignArgs, amountMicros: '9999999999', status: 'ENABLED', partialFailure: true,
    }))
    expect(result.status).toBe('committed')
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
    expect(body.partialFailure).toBe(false)
    expect(body.mutateOperations).toHaveLength(2)
    expect(body.mutateOperations[0].campaignBudgetOperation.create).toEqual({
      resourceName: 'customers/1234567890/campaignBudgets/-1', name: 'Trial',
      totalAmountMicros: '100000000', period: 'CUSTOM_PERIOD', explicitlyShared: false, deliveryMethod: 'STANDARD',
    })
    expect(body.mutateOperations[1].campaignOperation.create).toMatchObject({
      campaignBudget: 'customers/1234567890/campaignBudgets/-1', status: 'PAUSED',
      advertisingChannelType: 'SEARCH', manualCpc: {},
      startDateTime: campaignArgs.startDateTime, endDateTime: campaignArgs.endDateTime,
      geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
    })
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('login-customer-id')
  })

  it.each(['totalAmountMicros', 'startDateTime', 'endDateTime'])('rejects missing %s before the provider request', async (missing) => {
    const fetch = transport({})
    const args: Record<string, unknown> = { ...campaignArgs }
    delete args[missing]
    await expect(googleAdsConnector.executeMutation!(invocation('campaigns.createSearch', args))).rejects.toThrow(`missing required argument: ${missing}`)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['adGroups.create', { campaignId: '42', name: 'Intent', cpcBidMicros: '1500000' }, 'adGroupOperation', { campaign: 'customers/1234567890/campaigns/42', cpcBidMicros: '1500000' }],
    ['keywords.create', { adGroupId: '43', text: 'sales agent', matchType: 'EXACT', negative: true }, 'adGroupCriterionOperation', { adGroup: 'customers/1234567890/adGroups/43', negative: true, keyword: { text: 'sales agent', matchType: 'EXACT' } }],
    ['campaigns.addLocation', { campaignId: '42', geoTargetConstantId: '2840' }, 'campaignCriterionOperation', { location: { geoTargetConstant: 'geoTargetConstants/2840' } }],
    ['campaigns.addLanguage', { campaignId: '42', languageConstantId: '1000' }, 'campaignCriterionOperation', { language: { languageConstant: 'languageConstants/1000' } }],
  ])('renders %s through the same native mutation envelope', async (name, args, operation, expected) => {
    const fetch = transport({})
    await googleAdsConnector.executeMutation!(invocation(name, { customerId: '1234567890', ...args, validateOnly: true }))
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body))
    expect(body).toMatchObject({ validateOnly: true, partialFailure: false })
    expect(body.mutateOperations[0][operation].create).toMatchObject(expected)
  })

  it('preserves creative text and URLs, then launches or pauses using only the status mask', async () => {
    const fetch = transport({})
    const headlines = [{ text: 'Sell more' }, { text: 'Run your pipeline' }, { text: 'Know your next step' }]
    const descriptions = [{ text: 'Work with a GTM operator.' }, { text: 'Measure real outcomes.' }]
    await googleAdsConnector.executeMutation!(invocation('ads.createResponsiveSearch', {
      customerId: '1234567890', adGroupId: '43', headlines, descriptions, finalUrls: ['https://example.com/?utm_source=google'],
    }))
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).mutateOperations[0].adGroupAdOperation.create.ad)
      .toEqual({ finalUrls: ['https://example.com/?utm_source=google'], responsiveSearchAd: { headlines, descriptions } })
    for (const status of ['ENABLED', 'PAUSED']) {
      await googleAdsConnector.executeMutation!(invocation(status === 'ENABLED' ? 'campaigns.enable' : 'campaigns.pause', { customerId: '1234567890', campaignId: '42', status: 'REMOVED' }))
      expect(JSON.parse(String(fetch.mock.lastCall![1]?.body)).mutateOperations)
        .toEqual([{ campaignOperation: { update: { resourceName: 'customers/1234567890/campaigns/42', status }, updateMask: 'status' } }])
    }
  })

  it('pauses one creative without replacing its campaign or increasing the original budget', async () => {
    const fetch = transport({})
    await googleAdsConnector.executeMutation!(invocation('ads.pause', {
      customerId: '1234567890', adGroupId: '43', adId: '44', status: 'REMOVED',
    }))
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).mutateOperations).toEqual([
      { adGroupAdOperation: { update: { resourceName: 'customers/1234567890/adGroupAds/43~44', status: 'PAUSED' }, updateMask: 'status' } },
    ])
  })

  it('preserves Cloud-project access denial and distinguishes expired OAuth without leaking credentials', async () => {
    const fetch = transport({ error: { message: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION private-oauth-token' } }, 403)
    await expect(googleAdsConnector.executeRead!(invocation('customers.listAccessible', {})))
      .rejects.toThrow('CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION [REDACTED]')
    fetch.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(googleAdsConnector.executeRead!(invocation('customers.listAccessible', {}))).rejects.toBeInstanceOf(CredentialsExpired)
  })

  it('advertises launching as a scoped write without claiming upstream idempotency', async () => {
    const provider = createConnectorAdapterProvider({ adapters: [googleAdsConnector], resolveDataSource: async () => source })
    const [connector] = await provider.listConnectors()
    expect(connector?.actions.find(a => a.id === 'campaigns.enable')).toMatchObject({
      risk: 'destructive', requiredScopes: ['https://www.googleapis.com/auth/adwords'],
    })
    expect(googleAdsConnector.manifest.capabilities.filter(c => c.class === 'mutation').every(c => c.cas === 'none')).toBe(true)
  })
})
