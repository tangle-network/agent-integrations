import { afterEach, describe, expect, it, vi } from 'vitest'
import { constantContactConnector } from '../src/connectors/adapters/constant-contact.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cc_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'constant-contact',
    label: 'Constant Contact test',
    consistencyModel: 'authoritative',
    scopes: ['contact_data', 'campaign_data'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'cc_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('constant-contact adapter manifest', () => {
  it('classifies itself as the crm category and exposes the constant-contact kind', () => {
    expect(constantContactConnector.manifest.kind).toBe('constant-contact')
    expect(constantContactConnector.manifest.category).toBe('crm')
    expect(constantContactConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (matches the activepieces piece auth shape)', () => {
    const auth = constantContactConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('exposes the V3 contact + list + campaign surface', () => {
    const names = constantContactConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.upsert',
        'contacts.search',
        'contacts.get',
        'contacts.update',
        'contacts.delete',
        'lists.search',
        'lists.get',
        'lists.create',
        'contact.create',
        'campaign.create',
        'campaign.send',
      ].sort(),
    )
    const reads = constantContactConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = constantContactConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.get', 'contacts.search', 'lists.get', 'lists.search'].sort())
    expect(mutations).toEqual(
      [
        'campaign.create',
        'campaign.send',
        'contact.create',
        'contacts.delete',
        'contacts.update',
        'contacts.upsert',
        'lists.create',
      ].sort(),
    )
  })

  it('gates campaign mutations on the campaign_data scope', () => {
    const create = constantContactConnector.manifest.capabilities.find((c) => c.name === 'campaign.create')!
    const send = constantContactConnector.manifest.capabilities.find((c) => c.name === 'campaign.send')!
    expect(create.requiredScopes).toEqual(['campaign_data'])
    expect(send.requiredScopes).toEqual(['campaign_data'])
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const newOnes = ['contact.create', 'campaign.create', 'campaign.send']
    for (const name of newOnes) {
      const cap = constantContactConnector.manifest.capabilities.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('constant-contact campaign.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the campaign envelope to /v3/emails unchanged', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    let requestAuth: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      requestAuth = (init?.headers as Record<string, string> | undefined)?.authorization
      return jsonResponse({ campaign_id: 'camp_99' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const campaign = {
      name: 'June Newsletter',
      email_campaign_activities: [
        {
          format_type: 5,
          from_email: 'sender@example.com',
          from_name: 'Acme',
          reply_to_email: 'sender@example.com',
          subject: 'Hi',
          html_content: '<p>hi</p>',
        },
      ],
    }
    const result = await constantContactConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.create',
      args: { campaign },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.cc.email/v3/emails')
    expect(requestBody).toEqual(campaign)
    expect(requestAuth).toBe('Bearer cc_token')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('expired', { status: 401 })))
    await expect(
      constantContactConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaign.create',
        args: { campaign: { name: 'x' } },
        idempotencyKey: 'k-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('constant-contact campaign.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the schedule to /emails/activities/{id}/schedules', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ scheduled_date: '0' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await constantContactConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.send',
      args: { campaign_activity_id: 'act_1', scheduled_date: '0' },
      idempotencyKey: 'k-3',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.cc.email/v3/emails/activities/act_1/schedules')
    expect(requestBody).toEqual({ scheduled_date: '0' })
  })
})

describe('constant-contact contact.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v3/contacts (not the upsert sign_up_form path)', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse({ contact_id: 'cnt_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await constantContactConnector.executeMutation!({
      source: source(),
      capabilityName: 'contact.create',
      args: {
        email_address: { address: 'jane@example.com', permission_to_send: 'implicit' },
        first_name: 'Jane',
        last_name: 'Doe',
        job_title: 'Eng',
        company_name: 'Acme',
        phone_numbers: [],
        list_memberships: ['list_1'],
        custom_fields: [],
        create_source: 'Account',
      },
      idempotencyKey: 'k-4',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.cc.email/v3/contacts')
    expect(requestBody).toMatchObject({
      email_address: { address: 'jane@example.com', permission_to_send: 'implicit' },
      first_name: 'Jane',
      last_name: 'Doe',
      create_source: 'Account',
      list_memberships: ['list_1'],
    })
  })
})
