import { afterEach, describe, expect, it, vi } from 'vitest'
import { marketoConnector } from '../marketo.js'
import { validateConnectorManifest, type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_marketo',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'marketo',
  label: 'marketo',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: { restEndpoint: 'https://123-abc-456.mktorest.com' },
  credentials: { kind: 'oauth2', accessToken: 'mkto_token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('marketo adapter', () => {
  it('ships a valid connector manifest', () => {
    const result = validateConnectorManifest(marketoConnector.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('declares oauth2 against app.marketo.com identity service with marketo-shaped env names', () => {
    const auth = marketoConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth.kind narrowing failed')
    expect(auth.authorizationUrl).toBe('https://app.marketo.com/identity/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://app.marketo.com/identity/oauth/token')
    // Marketo gates capability by API Role assigned to the service user, not by OAuth scopes.
    expect(auth.scopes).toEqual([])
    expect(auth.clientIdEnv).toBe('MARKETO_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MARKETO_OAUTH_CLIENT_SECRET')
  })

  it('exposes the lead+list+campaign+activity action surface with the right read/mutation split', () => {
    expect(marketoConnector.manifest.kind).toBe('marketo')
    expect(marketoConnector.manifest.displayName).toBe('Marketo')
    expect(marketoConnector.manifest.category).toBe('crm')
    const names = marketoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'activities.search',
      'campaigns.search',
      'campaigns.trigger',
      'leads.describe',
      'leads.get',
      'leads.search',
      'leads.upsert',
      'lists.add-leads',
      'lists.get',
      'lists.remove-leads',
      'lists.search',
    ])
    const readers = marketoConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutators = marketoConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(readers).toEqual([
      'activities.search',
      'campaigns.search',
      'leads.describe',
      'leads.get',
      'leads.search',
      'lists.get',
      'lists.search',
    ])
    expect(mutators).toEqual([
      'campaigns.trigger',
      'leads.upsert',
      'lists.add-leads',
      'lists.remove-leads',
    ])
  })

  it('exposes both executeRead and executeMutation handlers', () => {
    expect(typeof marketoConnector.executeRead).toBe('function')
    expect(typeof marketoConnector.executeMutation).toBe('function')
  })

  it('routes reads against the per-tenant munchkin REST endpoint with bearer auth', async () => {
    const fetchMock = mockFetch({ result: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'leads.search',
      args: { filterType: 'email', filterValues: 'ada@example.com', batchSize: 100 },
      idempotencyKey: 'leads_1',
    }

    await marketoConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://123-abc-456.mktorest.com')
    expect(url.pathname).toBe('/rest/v1/leads.json')
    expect(url.searchParams.get('filterType')).toBe('email')
    expect(url.searchParams.get('filterValues')).toBe('ada@example.com')
    expect(url.searchParams.get('batchSize')).toBe('100')
    // Optional fields not supplied — declarative-REST must omit them, not send empty strings.
    expect(url.searchParams.has('fields')).toBe(false)
    expect(url.searchParams.has('nextPageToken')).toBe(false)
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer mkto_token_xyz' })
  })

  it('upserts leads with POST /rest/v1/leads.json forwarding the action/lookupField/input payload verbatim', async () => {
    const fetchMock = mockFetch({ requestId: 'abc', success: true, result: [{ id: 1, status: 'created' }] })
    const payload = {
      action: 'createOrUpdate',
      lookupField: 'email',
      input: [
        { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
        { email: 'grace@example.com', firstName: 'Grace', lastName: 'Hopper' },
      ],
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'leads.upsert',
      args: payload,
      idempotencyKey: 'upsert_1',
    }

    const result = await marketoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/rest/v1/leads.json')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer mkto_token_xyz',
      'content-type': 'application/json',
    })
    expect(JSON.parse(String(init.body))).toEqual(payload)
  })

  it('triggers a smart campaign via POST /rest/v1/campaigns/{id}/trigger.json with the input envelope', async () => {
    const fetchMock = mockFetch({ requestId: 'xyz', success: true })
    const triggerInput = {
      leads: [{ id: 12345 }, { id: 67890 }],
      tokens: [{ name: 'my.cta', value: 'https://example.com/cta' }],
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'campaigns.trigger',
      args: { campaignId: '1001', input: triggerInput },
      idempotencyKey: 'trigger_1',
    }

    const result = await marketoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/rest/v1/campaigns/1001/trigger.json')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ input: triggerInput })
  })

  it('adds leads to a static list via POST /rest/v1/lists/{listId}/leads.json wrapping the input array', async () => {
    const fetchMock = mockFetch({ requestId: 'list-add', success: true, result: [{ id: 12345, status: 'added' }] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'lists.add-leads',
      args: { listId: '2002', input: [{ id: 12345 }, { id: 67890 }] },
      idempotencyKey: 'list_add_1',
    }

    const result = await marketoConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/rest/v1/lists/2002/leads.json')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ input: [{ id: 12345 }, { id: 67890 }] })
  })
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string, _init?: RequestInit) => new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
