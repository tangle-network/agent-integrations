import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hellosign,
  type ResolvedDataSource,
} from '../../index.js'

const ACCESS_TOKEN = 'oauth_access_token_test'
const REFRESH_TOKEN = 'oauth_refresh_token_test'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_hellosign_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hellosign',
    label: 'Dropbox Sign',
    consistencyModel: 'authoritative',
    scopes: ['signature_request_access', 'request_signature'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('hellosign (Dropbox Sign) adapter', () => {
  const adapter = hellosign({ clientId: 'cid_test', clientSecret: 'sec_test' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares OAuth2 auth with the four required endpoint fields', () => {
    expect(adapter.manifest.auth.kind).toBe('oauth2')
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.authorizationUrl).toBe('https://app.hellosign.com/oauth/authorize')
      expect(adapter.manifest.auth.tokenUrl).toBe('https://app.hellosign.com/oauth/token')
      expect(adapter.manifest.auth.clientIdEnv).toBe('HELLOSIGN_OAUTH_CLIENT_ID')
      expect(adapter.manifest.auth.clientSecretEnv).toBe('HELLOSIGN_OAUTH_CLIENT_SECRET')
      expect(adapter.manifest.auth.scopes).toEqual(
        expect.arrayContaining(['basic_account_info', 'request_signature', 'signature_request_access']),
      )
    }
  })

  it('manifest exposes the e-signature capability triple', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'cancel_signature_request',
      'get_signature_request',
      'remind_signature_request',
      'send_signature_request',
    ])
    const send = adapter.manifest.capabilities.find((c) => c.name === 'send_signature_request')
    expect(send?.class).toBe('mutation')
    if (send?.class === 'mutation') {
      expect(send.cas).toBe('native-idempotency')
      expect(send.externalEffect).toBe(true)
    }
    const get = adapter.manifest.capabilities.find((c) => c.name === 'get_signature_request')
    expect(get?.class).toBe('read')
  })

  it('manifest pins category=doc and authoritative consistency for legal-grade signatures', () => {
    expect(adapter.manifest.category).toBe('doc')
    expect(adapter.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('send_signature_request POSTs to /signature_request/send_with_template with template ids + signers + idempotency metadata', async () => {
    let capturedUrl: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    let capturedHeaders: Record<string, string> | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers as Record<string, string>
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        signature_request: {
          signature_request_id: 'sr_abc123',
          test_mode: true,
          subject: 'Sign please',
          is_complete: false,
          created_at: 1700000000,
          signatures: [
            { signature_id: 'sig_1', email_address: 'signer@example.com', name: 'Signer', role: 'Client', status_code: 'awaiting_signature' },
          ],
        },
      })
    }))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_signature_request',
      args: {
        templateIds: ['tpl_1'],
        signers: [{ role: 'Client', email: 'signer@example.com', name: 'Signer' }],
        subject: 'Sign please',
        testMode: true,
      },
      idempotencyKey: 'idem-key-42',
    })
    expect(capturedUrl).toBe('https://api.hellosign.com/v3/signature_request/send_with_template')
    expect(capturedHeaders!.authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(capturedBody!.template_ids).toEqual(['tpl_1'])
    expect(capturedBody!.test_mode).toBe(1)
    expect((capturedBody!.metadata as Record<string, unknown>).tangle_idempotency_key).toBe('idem-key-42')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as { signatureRequestId: string; signers: Array<{ email: string }> }
      expect(data.signatureRequestId).toBe('sr_abc123')
      expect(data.signers[0].email).toBe('signer@example.com')
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('send_signature_request surfaces rate-limit with retryAfter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '11' } })))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_signature_request',
      args: { templateIds: ['t1'], signers: [{ role: 'A', email: 'x@y.com', name: 'X' }] },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('rate-limited')
    if (result.status === 'rate-limited') {
      expect(result.retryAfterMs).toBe(11_000)
    }
  })

  it('send_signature_request validates non-empty templateIds + signers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_signature_request',
      args: { templateIds: [], signers: [{ role: 'A', email: 'x@y.com', name: 'X' }] },
      idempotencyKey: 'k',
    })).rejects.toThrow(/templateIds/)
    await expect(adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_signature_request',
      args: { templateIds: ['t1'], signers: [] },
      idempotencyKey: 'k',
    })).rejects.toThrow(/signers/)
  })

  it('get_signature_request normalizes signers and the is_complete flag', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://api.hellosign.com/v3/signature_request/sr_done')
      return jsonResponse({
        signature_request: {
          signature_request_id: 'sr_done',
          is_complete: true,
          subject: 'NDA',
          created_at: 1700000000,
          signatures: [
            { signature_id: 'sig_1', email_address: 'a@b.com', name: 'A', role: 'Client', status_code: 'signed', signed_at: 1700001000 },
          ],
        },
      })
    }))
    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_signature_request',
      args: { signatureRequestId: 'sr_done' },
      idempotencyKey: 'k',
    })
    const data = result.data as { isComplete: boolean; signers: Array<{ status: string; signedAt?: number }> }
    expect(data.isComplete).toBe(true)
    expect(data.signers[0].status).toBe('signed')
    expect(data.signers[0].signedAt).toBe(1700001000)
  })

  it('get_signature_request raises CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'get_signature_request',
      args: { signatureRequestId: 'sr_dead' },
      idempotencyKey: 'k',
    })).rejects.toThrow(/Dropbox Sign/)
  })

  it('cancel_signature_request POSTs to /signature_request/cancel/:id and treats 200 as committed', async () => {
    let capturedUrl: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url)
      return new Response('', { status: 200 })
    }))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'cancel_signature_request',
      args: { signatureRequestId: 'sr_abc123' },
      idempotencyKey: 'k',
    })
    expect(capturedUrl).toBe('https://api.hellosign.com/v3/signature_request/cancel/sr_abc123')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as { status: string }
      expect(data.status).toBe('canceled')
    }
  })

  it('cancel_signature_request maps 409 (already completed) to ResourceContention', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 409 })))
    await expect(adapter.executeMutation!({
      source: source(),
      capabilityName: 'cancel_signature_request',
      args: { signatureRequestId: 'sr_done' },
      idempotencyKey: 'k',
    })).rejects.toThrow(/already completed/)
  })

  it('verifySignature accepts a payload whose event_hash matches HMAC_SHA256(accessToken, event_time + event_type)', () => {
    const event_time = '1700000000'
    const event_type = 'signature_request_signed'
    const event_hash = createHmac('sha256', ACCESS_TOKEN).update(`${event_time}${event_type}`).digest('hex')
    const body = JSON.stringify({
      event: { event_time, event_type, event_hash, event_id: 'evt_1' },
      signature_request: { signature_request_id: 'sr_1' },
    })
    const result = adapter.verifySignature!({
      rawBody: body,
      headers: {},
      source: source(),
    })
    expect(result.valid).toBe(true)
  })

  it('verifySignature rejects a tampered event_hash', () => {
    const body = JSON.stringify({
      event: { event_time: '1700000000', event_type: 'signature_request_signed', event_hash: 'deadbeef'.repeat(8) },
    })
    const result = adapter.verifySignature!({
      rawBody: body,
      headers: {},
      source: source(),
    })
    expect(result.valid).toBe(false)
  })

  it('verifySignature reports missing_credentials when source has no oauth token', () => {
    const noCreds = source({ credentials: { kind: 'none' } })
    const result = adapter.verifySignature!({
      rawBody: '{}',
      headers: {},
      source: noCreds,
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.reason).toBe('missing_credentials')
  })

  it('handleInboundEvent emits a hellosign.<event_type> event and responds with the literal Dropbox Sign ACK string', async () => {
    const event_time = '1700000000'
    const event_type = 'signature_request_all_signed'
    const event_hash = createHmac('sha256', ACCESS_TOKEN).update(`${event_time}${event_type}`).digest('hex')
    const body = JSON.stringify({
      event: { event_time, event_type, event_hash, event_id: 'evt_42' },
      signature_request: { signature_request_id: 'sr_1' },
    })
    const result = await adapter.handleInboundEvent!({
      source: source(),
      rawBody: body,
      headers: {},
    })
    expect(result.events).toHaveLength(1)
    expect(result.events[0].eventType).toBe('hellosign.signature_request_all_signed')
    expect(result.events[0].providerEventId).toBe('evt_42')
    expect(result.response?.status).toBe(200)
    expect(result.response?.body).toBe('Hello API Event Received')
  })

  it('handleInboundEvent rejects bodies it cannot parse', async () => {
    const result = await adapter.handleInboundEvent!({
      source: source(),
      rawBody: 'not-json-not-multipart',
      headers: {},
    })
    expect(result.events).toHaveLength(0)
    expect(result.response?.status).toBe(400)
  })

  it('refreshes expired access tokens via the token endpoint before invoking', async () => {
    const expiredSource = source({
      credentials: {
        kind: 'oauth2',
        accessToken: 'expired',
        refreshToken: REFRESH_TOKEN,
        expiresAt: Date.now() - 1_000,
      },
    })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).includes('/oauth/token')) {
        return jsonResponse({
          access_token: 'fresh_token',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      }
      return jsonResponse({
        signature_request: {
          signature_request_id: 'sr_x',
          is_complete: false,
          signatures: [],
        },
      })
    }))
    await adapter.executeRead!({
      source: expiredSource,
      capabilityName: 'get_signature_request',
      args: { signatureRequestId: 'sr_x' },
      idempotencyKey: 'k',
    })
    expect(calls[0].url).toBe('https://app.hellosign.com/oauth/token')
    const apiCall = calls[1]
    expect((apiCall.init?.headers as Record<string, string>).authorization).toBe('Bearer fresh_token')
  })

  it('test() returns ok on 200 and reports reconnect-required on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ account: { account_id: 'acc' } })))
    expect(await adapter.test(source())).toEqual({ ok: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const failed = await adapter.test(source())
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toMatch(/reconnect/)
  })

  it('exchangeOAuth round-trips authorization code → credentials envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('https://app.hellosign.com/oauth/token')
      return jsonResponse({
        access_token: 'at_new',
        refresh_token: 'rt_new',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'basic_account_info request_signature',
      })
    }))
    const result = await adapter.exchangeOAuth!({
      code: 'auth_code_xyz',
      state: 'state_xyz',
      codeVerifier: 'cv_xyz',
      redirectUri: 'https://app.example.com/cb',
    })
    expect(result.credentials.kind).toBe('oauth2')
    if (result.credentials.kind === 'oauth2') {
      expect(result.credentials.accessToken).toBe('at_new')
      expect(result.credentials.refreshToken).toBe('rt_new')
    }
    expect(result.scopes).toEqual(['basic_account_info', 'request_signature'])
  })
})
