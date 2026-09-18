import { describe, expect, it, vi } from 'vitest'
import { TangleAppsClient, requireBrokerGrantReceipt, createTangleAppsClient } from '../src/apps'
import { IntegrationRuntimeError } from '../src/errors'

const ENDPOINT = 'https://id.tangle.tools'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init),
  ) as unknown as typeof fetch
}

describe('TangleAppsClient', () => {
  it('registerApp posts to /v1/apps with the owner bearer and returns the once-shown secret', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const client = createTangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, init }
        return jsonResponse({
          success: true,
          data: {
            app: { id: 'app_1', clientId: 'appcid_x', name: 'insurance-agent', redirectUris: ['https://insurance.tangle.tools/cb'], allowedScopes: ['gmail.messages_read'] },
            clientSecret: 'appcs_secret',
          },
        })
      }),
    })
    const app = await client.registerApp(
      { name: 'insurance-agent', redirectUris: ['https://insurance.tangle.tools/cb'], allowedScopes: ['gmail.messages_read'] },
      'sk-tan-owner',
    )
    expect(captured?.url).toBe(`${ENDPOINT}/v1/apps`)
    expect(new Headers(captured?.init?.headers).get('authorization')).toBe('Bearer sk-tan-owner')
    expect(app.clientId).toBe('appcid_x')
    expect(app.clientSecret).toBe('appcs_secret')
  })

  it('mintBrokerToken uses app credentials (no user bearer) and returns a sk-tan-broker- token', async () => {
    let captured: { url: string; init?: RequestInit } | undefined
    const client = new TangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, init }
        return jsonResponse({ success: true, data: { access_token: 'sk-tan-broker-abc', expires_in: 900, scope: 'gmail.messages_read', connection_id: 'conn_1' } })
      }),
    })
    const tok = await client.mintBrokerToken({ clientId: 'appcid_x', clientSecret: 'appcs_secret', grantId: 'grant_42', ttlSeconds: 300 })
    expect(captured?.url).toBe(`${ENDPOINT}/v1/apps/grants/grant_42/mint-broker-token`)
    expect(new Headers(captured?.init?.headers).get('authorization')).toBeNull()
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({ client_id: 'appcid_x', client_secret: 'appcs_secret', grant_id: 'grant_42', ttl_seconds: 300 })
    expect(tok.accessToken).toBe('sk-tan-broker-abc')
    expect(tok.accessToken.startsWith('sk-tan-broker-')).toBe(true)
    expect(tok.expiresIn).toBe(900)
    expect(tok.connectionId).toBe('conn_1')
  })

  it('exchangeAuthCode posts the agc_ code on the flat OAuth token endpoint', async () => {
    let body: Record<string, unknown> | undefined
    const client = new TangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch((_url, init) => {
        body = JSON.parse(String(init?.body))
        return jsonResponse({ access_token: 'sk-tan-broker-first', token_type: 'Bearer', expires_in: 3600, scope: 'gmail.messages_read' })
      }),
    })
    const tok = await client.exchangeAuthCode({ clientId: 'appcid_x', clientSecret: 'appcs_secret', code: 'agc_code', redirectUri: 'https://insurance.tangle.tools/cb' })
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'agc_code', client_id: 'appcid_x' })
    expect(tok.accessToken).toBe('sk-tan-broker-first')
    expect(tok.expiresIn).toBe(3600)
  })

  it('maps the BROKER_DISABLED platform error to an IntegrationRuntimeError', async () => {
    const client = new TangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch(() => jsonResponse({ success: false, error: { message: 'broker disabled', code: 'BROKER_DISABLED' } }, 503)),
    })
    const err = await client.mintBrokerToken({ clientId: 'a', clientSecret: 'b', grantId: 'g' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IntegrationRuntimeError)
    expect((err as IntegrationRuntimeError).code).toBe('passthrough_disabled')
    expect((err as IntegrationRuntimeError).status).toBe(503)
    expect((err as IntegrationRuntimeError).metadata).toMatchObject({ platformCode: 'BROKER_DISABLED' })
  })

  it('normalizes a trailing slash in endpoint', async () => {
    let url = ''
    const client = new TangleAppsClient({
      endpoint: `${ENDPOINT}/`,
      fetchImpl: mockFetch((u) => {
        url = u
        return jsonResponse({ data: { access_token: 'sk-tan-broker-z', expires_in: 60, scope: 's' } })
      }),
    })
    await client.mintBrokerToken({ clientId: 'a', clientSecret: 'b', grantId: 'g' })
    expect(url).toBe(`${ENDPOINT}/v1/apps/grants/g/mint-broker-token`)
  })

  it.each([
    ['wrong prefix', { access_token: 'sk-other-token', expires_in: 60, scope: 'read' }],
    ['missing token', { expires_in: 60, scope: 'read' }],
    ['zero expiry', { access_token: 'sk-tan-broker-x', expires_in: 0, scope: 'read' }],
    ['negative expiry', { access_token: 'sk-tan-broker-x', expires_in: -1, scope: 'read' }],
    ['expiry beyond Platform maximum', { access_token: 'sk-tan-broker-x', expires_in: 3601, scope: 'read' }],
    ['empty scope', { access_token: 'sk-tan-broker-x', expires_in: 60, scope: '  ' }],
  ])('rejects broker response with %s', async (_label, response) => {
    const client = new TangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl: mockFetch(() => jsonResponse({ success: true, data: response })),
    })
    await expect(client.mintBrokerToken({ clientId: 'a', clientSecret: 'b', grantId: 'g' })).rejects.toMatchObject({
      code: 'input_invalid',
      status: 502,
    })
  })

  it('rejects an owner claim without a Platform owner policy', async () => {
    const client = new TangleAppsClient({ endpoint: ENDPOINT, fetchImpl: mockFetch(() => jsonResponse({})) })
    await expect(client.mintBrokerToken({
      clientId: 'a',
      clientSecret: 'b',
      grantId: 'g',
      ownerUserId: 'user_1',
    })).rejects.toMatchObject({ code: 'input_invalid', status: 403 })
  })

  it('does not accept a broker key as an app owner bearer', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}))
    const client = new TangleAppsClient({ endpoint: ENDPOINT, fetchImpl })
    await expect(client.listApps('sk-tan-broker-owner')).rejects.toMatchObject({
      code: 'input_invalid',
      status: 400,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not send a broker request for a rejected owner claim', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({
      access_token: 'sk-tan-broker-x',
      expires_in: 60,
      scope: 'read',
    }))
    const client = new TangleAppsClient({
      endpoint: ENDPOINT,
      fetchImpl,
      ownerPolicy: { authorize: () => false },
    })
    await expect(client.exchangeAuthCode({
      clientId: 'a',
      clientSecret: 'b',
      code: 'agc_code',
      redirectUri: 'https://app/callback',
      ownerUserId: 'user_1',
    })).rejects.toMatchObject({ code: 'provider_auth_failed', status: 403 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not let a blank owner claim bypass the owner policy', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({
      access_token: 'sk-tan-broker-x',
      expires_in: 60,
      scope: 'read',
    }))
    const client = new TangleAppsClient({ endpoint: ENDPOINT, fetchImpl })
    await expect(client.mintBrokerToken({
      clientId: 'a',
      clientSecret: 'b',
      grantId: 'g',
      ownerUserId: '   ',
    })).rejects.toMatchObject({ code: 'input_invalid', status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})


describe('durable grant receipts', () => {
  const receipt = { access_token: 'sk-tan-broker-fixture', expires_in: 60, scope: 'gmail.messages_read',
    connection_id: 'customer-gmail', grant_id: 'grant-owned', user_id: 'platform-alice', client_id: 'assistant-app' }
  const expected = { ownerUserId: 'platform-alice', clientId: 'assistant-app', connectionId: 'customer-gmail', scopes: ['gmail.messages_read'] }
  async function token(value = receipt) {
    const client = new TangleAppsClient({ endpoint: ENDPOINT, fetchImpl: mockFetch(() => jsonResponse(value)) })
    return client.exchangeAuthCode({ clientId: 'assistant-app', clientSecret: 'test-secret', code: 'agc_test', redirectUri: 'https://app.test/callback' })
  }
  it('preserves the host-issued grant and principal for later per-call minting', async () => {
    const result = await token()
    expect(requireBrokerGrantReceipt(result, expected)).toEqual({ grantId: 'grant-owned', connectionId: 'customer-gmail', ownerUserId: 'platform-alice', clientId: 'assistant-app', scopes: ['gmail.messages_read'] })
  })
  it.each(['user_id', 'client_id', 'connection_id', 'grant_id'] as const)('rejects mismatched %s for an existing grant', async field => {
    const result = await token({ ...receipt, [field]: 'another-identity' })
    expect(() => requireBrokerGrantReceipt(result, { ...expected, grantId: 'grant-owned' })).toThrow(/does not match/)
  })
  it('keeps old hosts compatible for immediate calls, but cannot invent a durable grant', async () => {
    const result = await token({ ...receipt, grant_id: undefined, user_id: undefined, client_id: undefined } as unknown as typeof receipt)
    expect(result.accessToken).toBe(receipt.access_token)
    expect(() => requireBrokerGrantReceipt(result, expected)).toThrow(/does not match/)
  })
  it('refuses broader or narrower scope receipts', async () => {
    const result = await token({ ...receipt, scope: 'gmail.messages_read gmail.messages_send' })
    expect(() => requireBrokerGrantReceipt(result, expected)).toThrow(/does not match/)
  })
  it.each(['', 123, null, 'x'.repeat(257)])('rejects malformed grant identity: %j', async grant_id => {
    await expect(token({ ...receipt, grant_id } as unknown as typeof receipt)).rejects.toMatchObject({ code: 'input_invalid', status: 502 })
  })
})
