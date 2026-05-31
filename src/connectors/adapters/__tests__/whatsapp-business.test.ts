import { afterEach, describe, expect, it, vi } from 'vitest'
import { whatsappBusiness } from '../whatsapp-business.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../../types.js'

const opts = { clientId: 'client_id', clientSecret: 'client_secret' }

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_wa_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'whatsapp-business',
    label: 'WhatsApp Business',
    consistencyModel: 'advisory',
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    metadata: { phoneNumberId: '1234567890', wabaId: '9876543210' },
    credentials: { kind: 'oauth2', accessToken: 'EAA_token_123' },
    status: 'active',
    ...overrides,
  }
}

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (_input: URL | string | Request, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...init.headers },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('whatsappBusiness adapter', () => {
  it('ships a valid connector manifest with oauth2 endpoints and env-var names', () => {
    const adapter = whatsappBusiness(opts)
    const result = validateConnectorManifest(adapter.manifest)
    expect(result).toEqual({ ok: true, issues: [] })

    expect(adapter.manifest.kind).toBe('whatsapp-business')
    expect(adapter.manifest.displayName).toBe('WhatsApp Business')
    expect(adapter.manifest.category).toBe('comms')
    expect(adapter.manifest.defaultConsistencyModel).toBe('advisory')

    const auth = adapter.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2')
    expect(auth.authorizationUrl).toBe('https://www.facebook.com/v21.0/dialog/oauth')
    expect(auth.tokenUrl).toBe('https://graph.facebook.com/v21.0/oauth/access_token')
    expect(auth.scopes).toEqual(['whatsapp_business_messaging', 'whatsapp_business_management', 'business_management'])
    expect(auth.clientIdEnv).toBe('WHATSAPP_BUSINESS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('WHATSAPP_BUSINESS_OAUTH_CLIENT_SECRET')
  })

  it('exposes the documented action map (sends + reads)', () => {
    const adapter = whatsappBusiness(opts)
    const names = adapter.manifest.capabilities.map((c) => c.name)
    expect(names).toEqual([
      'send_text_message',
      'send_template_message',
      'list_message_templates',
      'get_business_phone_number',
    ])

    for (const cap of adapter.manifest.capabilities) {
      if (cap.class === 'mutation') {
        // outbound chat is append-only — Meta has no idempotency primitive on /messages,
        // so MutationGuard owns dedup above us.
        expect(cap.cas).toBe('none')
        expect(cap.externalEffect).toBe(true)
      }
    }
  })

  it('builds an OAuth authorize URL with the documented Meta scopes', () => {
    const adapter = whatsappBusiness(opts)
    const auth = adapter.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2')
    // The hub constructs the authorize URL by appending standard OAuth2 params; assert the
    // adapter exposes everything the constructor needs to build a correct URL.
    const url = new URL(auth.authorizationUrl)
    url.searchParams.set('client_id', 'env_client_id')
    url.searchParams.set('redirect_uri', 'https://app.example.com/oauth/callback')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', auth.scopes.join(','))
    url.searchParams.set('state', 'state_abc')
    expect(url.host).toBe('www.facebook.com')
    expect(url.pathname).toBe('/v21.0/dialog/oauth')
    expect(url.searchParams.get('scope')).toBe('whatsapp_business_messaging,whatsapp_business_management,business_management')
    expect(url.searchParams.get('client_id')).toBe('env_client_id')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('send_text_message posts a Meta-shaped JSON body to /{phoneNumberId}/messages', async () => {
    const fetchMock = mockFetch({
      messaging_product: 'whatsapp',
      contacts: [{ input: '+14155551212', wa_id: '14155551212' }],
      messages: [{ id: 'wamid.ABC123', message_status: 'accepted' }],
    })
    const adapter = whatsappBusiness(opts)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_text_message',
      args: { to: '+14155551212', body: 'hello world', previewUrl: true },
      idempotencyKey: 'k1',
    })

    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('expected committed')
    expect(result.data).toEqual({
      messageId: 'wamid.ABC123',
      messageStatus: 'accepted',
      waId: '14155551212',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('https://graph.facebook.com/v21.0/1234567890/messages')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer EAA_token_123')
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155551212',
      type: 'text',
      text: { body: 'hello world', preview_url: true },
    })
  })

  it('send_template_message uses the template payload shape with language code', async () => {
    const fetchMock = mockFetch({
      messages: [{ id: 'wamid.T1' }],
      contacts: [{ input: '+14155551212', wa_id: '14155551212' }],
    })
    const adapter = whatsappBusiness(opts)

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_template_message',
      args: {
        to: '+14155551212',
        template: 'order_confirmation',
        language: 'en_US',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ada' }] }],
      },
      idempotencyKey: 'k2',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+14155551212',
      type: 'template',
      template: {
        name: 'order_confirmation',
        language: { code: 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ada' }] }],
      },
    })
  })

  it('list_message_templates queries the WABA-scoped templates endpoint', async () => {
    const fetchMock = mockFetch({
      data: [
        { id: 't1', name: 'welcome', status: 'APPROVED', language: 'en_US', category: 'UTILITY' },
        { id: 't2', name: 'shipped', status: 'APPROVED', language: 'en_US', category: 'UTILITY' },
      ],
    })
    const adapter = whatsappBusiness(opts)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_message_templates',
      args: { limit: 25, status: 'APPROVED' },
      idempotencyKey: 'k3',
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    expect(String(url)).toContain('https://graph.facebook.com/v21.0/9876543210/message_templates?')
    expect(String(url)).toContain('limit=25')
    expect(String(url)).toContain('status=APPROVED')
    expect((result.data as { templates: unknown[] }).templates).toHaveLength(2)
  })

  it('test() probes the phone-number endpoint when metadata is set', async () => {
    const fetchMock = mockFetch({ display_phone_number: '+1 415-555-1212' })
    const adapter = whatsappBusiness(opts)
    const result = await adapter.test(source())
    expect(result).toEqual({ ok: true })
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(String(url)).toContain('/v21.0/1234567890?fields=display_phone_number')
  })

  it('test() surfaces 401 as a typed reconnect reason', async () => {
    mockFetch({ error: 'expired' }, { status: 401 })
    const adapter = whatsappBusiness(opts)
    const result = await adapter.test(source())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.reason).toMatch(/reconnect required/)
  })

  it('throws if DataSource.metadata.phoneNumberId is missing on send', async () => {
    mockFetch({}, { status: 200 })
    const adapter = whatsappBusiness(opts)
    await expect(
      adapter.executeMutation!({
        source: source({ metadata: { wabaId: '9876543210' } }),
        capabilityName: 'send_text_message',
        args: { to: '+14155551212', body: 'hi' },
        idempotencyKey: 'k4',
      }),
    ).rejects.toThrow(/phoneNumberId/)
  })
})
