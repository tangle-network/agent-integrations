import { describe, expect, it, vi } from 'vitest'
import { TangleAppsClient, createTangleAppsClient } from '../src/apps'
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
})
