import { afterEach, describe, expect, it, vi } from 'vitest'
import { hellosign } from '../src/connectors/adapters/hellosign.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_hellosign_remind_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hellosign',
    label: 'hellosign remind test',
    consistencyModel: 'authoritative',
    scopes: ['request_signature'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'hellosign_access_token_test',
      refreshToken: 'hellosign_refresh_token_test',
      expiresAt: Date.now() + 60 * 60 * 1000,
    },
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

const adapter = hellosign({ clientId: 'cid_test', clientSecret: 'sec_test' })

describe('hellosign adapter manifest (remind capability)', () => {
  it('exposes remind_signature_request as a native-idempotency external-effect mutation', () => {
    const remind = adapter.manifest.capabilities.find((c) => c.name === 'remind_signature_request')
    if (!remind) throw new Error('remind_signature_request missing from manifest')
    expect(remind.class).toBe('mutation')
    if (remind.class !== 'mutation') throw new Error('unreachable')
    expect(remind.cas).toBe('native-idempotency')
    expect(remind.externalEffect).toBe(true)
    const params = remind.parameters as { required?: string[] }
    expect(params.required).toEqual(['signatureRequestId', 'emailAddress'])
  })

  it('marks every mutation as native-idempotency externalEffect', () => {
    for (const cap of adapter.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('hellosign remind_signature_request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /signature_request/remind/{id} with email_address in JSON body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string
      return jsonResponse({ signature_request: { signature_request_id: 'sr_1', is_complete: false, signatures: [] } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'remind_signature_request',
      args: { signatureRequestId: 'sr_1', emailAddress: 'signer@example.com' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.hellosign.com/v3/signature_request/remind/sr_1')
    const parsed = JSON.parse(requestBody ?? '{}')
    expect(parsed.email_address).toBe('signer@example.com')
    expect(result.status).toBe('committed')
  })

  it('rejects when signatureRequestId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'remind_signature_request',
        args: { emailAddress: 'signer@example.com' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toThrow(/signatureRequestId/)
  })

  it('rejects when emailAddress is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'remind_signature_request',
        args: { signatureRequestId: 'sr_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toThrow(/emailAddress/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'remind_signature_request',
        args: { signatureRequestId: 'sr_1', emailAddress: 'signer@example.com' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('maps 429 to rate-limited with Retry-After honoured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '3' } })),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'remind_signature_request',
      args: { signatureRequestId: 'sr_1', emailAddress: 'signer@example.com' },
      idempotencyKey: 'k-1',
    })
    if (result.status !== 'rate-limited') throw new Error(`expected rate-limited, got ${result.status}`)
    expect(result.retryAfterMs).toBe(3_000)
  })
})
