import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/adapter-provider.js'
import {
  CONNECTOR_ADAPTER_FACTORIES,
  biginByZohoConnector,
  resolveConnectorAdapterFactoryOptions,
  zohoBookingsConnector,
  zohoBooksConnector,
  zohoCampaignsConnector,
  zohoCrmConnector,
  zohoDeskConnector,
  zohoInvoiceConnector,
  zohoMailConnector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

const suite = [
  zohoCrmConnector,
  biginByZohoConnector,
  zohoDeskConnector,
  zohoBookingsConnector,
  zohoBooksConnector,
  zohoInvoiceConnector,
  zohoMailConnector,
  zohoCampaignsConnector,
]

function source(kind: string, metadata: Record<string, unknown> = {}): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'oauth2', accessToken: 'zoho-token' },
    status: 'active',
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('Zoho shared OAuth application', () => {
  it('registers eight provider packs behind one canonical OAuth app', () => {
    const expectedEnvMap = {
      clientId: [
        'ZOHO_OAUTH_CLIENT_ID',
        'ZOHO_CRM_OAUTH_CLIENT_ID',
        'BIGIN_BY_ZOHO_OAUTH_CLIENT_ID',
      ],
      clientSecret: [
        'ZOHO_OAUTH_CLIENT_SECRET',
        'ZOHO_CRM_OAUTH_CLIENT_SECRET',
        'BIGIN_BY_ZOHO_OAUTH_CLIENT_SECRET',
      ],
    }

    for (const adapter of suite) {
      const kind = adapter.manifest.kind
      const auth = adapter.manifest.auth
      expect(auth.kind, kind).toBe('oauth2')
      if (auth.kind !== 'oauth2') throw new Error(`${kind} must use OAuth2`)
      expect(auth.clientIdEnv, kind).toBe('ZOHO_OAUTH_CLIENT_ID')
      expect(auth.clientSecretEnv, kind).toBe('ZOHO_OAUTH_CLIENT_SECRET')
      expect(auth.scopeSeparator, kind).toBe(',')
      expect(auth.scopes, kind).not.toContain('offline_access')
      expect(auth.extraAuthParams, kind).toEqual({ access_type: 'offline', prompt: 'consent' })
      expect(adapter.manifest.capabilities.length, kind).toBeGreaterThan(0)

      const definition = CONNECTOR_ADAPTER_FACTORIES.find((candidate) => candidate.kind === kind)
      expect(definition, kind).toBeDefined()
      expect(definition!.envMap, kind).toEqual(expectedEnvMap)
      expect(resolveConnectorAdapterFactoryOptions(definition!, {}), kind).toBeNull()
      expect(resolveConnectorAdapterFactoryOptions(definition!, {
        ZOHO_OAUTH_CLIENT_ID: 'client-id',
        ZOHO_OAUTH_CLIENT_SECRET: 'client-secret',
      }), kind).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' })
    }
  })

  it('emits the exact Zoho authorization URL contract', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [zohoCrmConnector],
      resolveDataSource: () => ({}) as never,
      resolveOAuthClient: () => ({ clientId: 'zoho-client', clientSecret: 'zoho-secret' }),
    })
    const result = await provider.startAuth!({
      connectorId: 'zoho-crm',
      owner: { type: 'user', id: 'user_1' },
      requestedScopes: [],
      redirectUri: 'https://id.tangle.tools/v1/hub/connections/oauth/callback',
    })
    const url = new URL(result.authUrl)
    expect(url.searchParams.get('scope')).toBe(
      'ZohoCRM.modules.ALL,ZohoCRM.users.READ,ZohoCRM.settings.READ',
    )
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('keeps all externally visible sends behind mutation approval metadata', () => {
    for (const [adapter, capability] of [
      [zohoBooksConnector, 'invoices.send'],
      [zohoInvoiceConnector, 'invoices.send'],
      [zohoMailConnector, 'messages.send'],
      [zohoCampaignsConnector, 'campaigns.send'],
    ] as const) {
      const action = adapter.manifest.capabilities.find((candidate) => candidate.name === capability)
      expect(action, capability).toMatchObject({ class: 'mutation', externalEffect: true })
    }
  })
})

describe('Zoho Books and Invoice direct execution', () => {
  it('routes regional Zoho Books reads with organization isolation', async () => {
    let url = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ invoices: [] })
    }))

    const result = await zohoBooksConnector.executeRead!({
      source: source('zoho-books', { apiDomain: 'https://www.zohoapis.eu' }),
      capabilityName: 'invoices.list',
      args: { organization_id: 'org-1', status: 'sent', per_page: 50 },
      idempotencyKey: 'read-1',
    })

    expect(url).toBe('https://www.zohoapis.eu/books/v3/invoices?organization_id=org-1&status=sent&per_page=50')
    expect(authorization).toBe('Zoho-oauthtoken zoho-token')
    expect(result.data).toEqual({ invoices: [] })
  })

  it('uses the Zoho Invoice API path and rejects lookalike credential-exfiltration hosts', async () => {
    let url = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      url = String(input)
      return jsonResponse({ invoices: [] })
    }))

    await zohoInvoiceConnector.executeRead!({
      source: source('zoho-invoice', { apiDomain: 'https://www.zohoapis.com' }),
      capabilityName: 'invoices.list',
      args: { organization_id: 'org-2', last_modified_at: '2026-07-30' },
      idempotencyKey: 'read-2',
    })
    expect(url).toBe('https://www.zohoapis.com/invoice/v3/invoices?organization_id=org-2&last_modified_at=2026-07-30')

    await expect(zohoInvoiceConnector.executeRead!({
      source: source('zoho-invoice', { apiDomain: 'https://www.zohoapis.com.attacker.test' }),
      capabilityName: 'invoices.list',
      args: { organization_id: 'org-2' },
      idempotencyKey: 'read-3',
    })).rejects.toThrow('not an allowed provider endpoint')
  })
})

describe('Zoho Mail direct execution', () => {
  it('sends provider-native JSON through the selected Zoho data center', async () => {
    let url = ''
    let body: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ status: { code: 200 } })
    }))

    const result = await zohoMailConnector.executeMutation!({
      source: source('zoho-mail', { mailApiDomain: 'https://mail.zoho.eu' }),
      capabilityName: 'messages.send',
      args: {
        accountId: 'account-1',
        fromAddress: 'drew@tangle.tools',
        toAddress: 'buyer@example.com',
        subject: 'Follow up',
        content: 'Hello',
        mailFormat: 'plaintext',
      },
      idempotencyKey: 'send-1',
    })

    expect(url).toBe('https://mail.zoho.eu/api/accounts/account-1/messages')
    expect(body).toEqual({
      fromAddress: 'drew@tangle.tools',
      toAddress: 'buyer@example.com',
      subject: 'Follow up',
      content: 'Hello',
      mailFormat: 'plaintext',
    })
    expect(result.status).toBe('committed')
  })
})

describe('Zoho Campaigns form API', () => {
  it('creates a campaign using the provider form contract', async () => {
    let url = ''
    let contentType = ''
    let form = new URLSearchParams()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input)
      contentType = new Headers(init?.headers).get('content-type') ?? ''
      form = new URLSearchParams(String(init?.body))
      return jsonResponse({ campaignKey: 'campaign-1' })
    }))

    const result = await zohoCampaignsConnector.executeMutation!({
      source: source('zoho-campaigns', { zohoLocation: 'zoho.eu' }),
      capabilityName: 'campaigns.create',
      args: {
        campaignname: 'Launch',
        subject: 'Tangle launch',
        from_name: 'Tangle',
        from_email: 'drew@tangle.tools',
        list_details: { list_1: [] },
      },
      idempotencyKey: 'campaign-1',
    })

    expect(url).toBe('https://campaigns.zoho.eu/api/v1.1/createCampaign')
    expect(contentType).toBe('application/x-www-form-urlencoded')
    expect(form.get('resfmt')).toBe('JSON')
    expect(form.get('campaignname')).toBe('Launch')
    expect(form.get('list_details')).toBe('{"list_1":[]}')
    expect(result.status).toBe('committed')
  })

  it('fails closed on unrecognized data centers and classifies provider throttling', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'slow down' }, 429, { 'retry-after': '2' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(zohoCampaignsConnector.executeRead!({
      source: source('zoho-campaigns', { zohoLocation: 'zoho.com.attacker.test' }),
      capabilityName: 'campaigns.list',
      args: {},
      idempotencyKey: 'read-4',
    })).rejects.toThrow('not an allowed Zoho data center')
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(zohoCampaignsConnector.executeRead!({
      source: source('zoho-campaigns'),
      capabilityName: 'campaigns.list',
      args: {},
      idempotencyKey: 'read-5',
    })).rejects.toMatchObject({ name: 'ProviderRateLimited', retryAfterMs: 2_000 })
  })
})
