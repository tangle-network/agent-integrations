import { afterEach, describe, expect, it, vi } from 'vitest'
import { calCom, calComConnector } from '../cal-com.js'
import { type ConnectorInvocation, type ResolvedDataSource } from '../../types.js'

const source: ResolvedDataSource = {
  id: 'source_cal_com',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'cal-com',
  label: 'cal.com',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'oauth2', accessToken: 'cal_token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cal-com adapter', () => {
  it('binds public-client refresh to the credential-aware factory', () => {
    const adapter = calCom({ clientId: 'cal_public_client' })
    expect(adapter.exchangeOAuth).toBeTypeOf('function')
    expect(adapter.refreshToken).toBeTypeOf('function')
    expect(calComConnector.refreshToken).toBeUndefined()
  })

  it('exchanges a code as a PKCE public client', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      const body = init?.body as URLSearchParams
      expect(headers.authorization).toBeUndefined()
      expect(body.get('client_id')).toBe('cal_public_client')
      expect(body.has('client_secret')).toBe(false)
      expect(body.get('code_verifier')).toBe('v'.repeat(64))
      return Response.json({
        access_token: 'fresh_access',
        refresh_token: 'fresh_refresh',
        expires_in: 3600,
        scope: 'PROFILE_READ BOOKING_READ',
      })
    }) as typeof fetch
    const adapter = calCom({
      clientId: 'cal_public_client',
      fetchImpl,
      now: () => 1_000,
    })

    await expect(adapter.exchangeOAuth!({
      code: 'authorization_code',
      state: 'state',
      codeVerifier: 'v'.repeat(64),
      redirectUri: 'https://id.tangle.tools/api/integrations/oauth/cal-com/callback',
    })).resolves.toEqual({
      credentials: {
        kind: 'oauth2',
        accessToken: 'fresh_access',
        refreshToken: 'fresh_refresh',
        expiresAt: 3_601_000,
      },
      scopes: ['PROFILE_READ', 'BOOKING_READ'],
      metadata: {},
    })
  })

  it('declares Cal.com Platform oauth2 against app.cal.com with the v2 token exchange', () => {
    const auth = calComConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('auth.kind narrowing failed')
    expect(auth.authorizationUrl).toBe('https://app.cal.com/auth/oauth2/authorize')
    expect(auth.tokenUrl).toBe('https://api.cal.com/v2/auth/oauth2/token')
    expect(auth.clientIdEnv).toBe('CALCOM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBeUndefined()
    expect(auth.pkce).toBe('required')
    expect(auth.tokenClientAuthMethod).toBe('none')
    expect(auth.scopes).toContain('BOOKING_WRITE')
    expect(auth.scopes).toContain('BOOKING_READ')
    expect(auth.scopes).toContain('EVENT_TYPE_READ')
    expect(auth.scopes).toContain('EVENT_TYPE_WRITE')
  })

  it('lists bookings via GET /v2/bookings with bearer auth, the cal-api-version pin, and only set query params', async () => {
    const fetchMock = mockFetch({ data: [] })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'bookings.list',
      args: { status: 'upcoming', limit: 50 },
      idempotencyKey: 'bookings_1',
    }

    await calComConnector.executeRead!(invocation)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.origin).toBe('https://api.cal.com')
    expect(url.pathname).toBe('/v2/bookings')
    expect(url.searchParams.get('status')).toBe('upcoming')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.has('attendeeEmail')).toBe(false)
    expect(url.searchParams.has('eventTypeId')).toBe(false)
    expect((init as RequestInit).headers).toMatchObject({
      authorization: 'Bearer cal_token_xyz',
      'cal-api-version': '2026-05-01',
    })
  })

  it('creates a booking via POST /v2/bookings with the v2 body shape', async () => {
    const fetchMock = mockFetch({ data: { uid: 'bk_abc' } })
    const body = {
      eventTypeId: 42,
      start: '2026-06-01T15:00:00Z',
      attendee: { name: 'Ada Lovelace', email: 'ada@example.com', timeZone: 'America/New_York' },
    }
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'bookings.create',
      args: body,
      idempotencyKey: 'create_1',
    }

    const result = await calComConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/bookings')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      authorization: 'Bearer cal_token_xyz',
      'content-type': 'application/json',
      'cal-api-version': '2026-02-25',
    })
    expect(JSON.parse(String(init.body))).toEqual(body)
  })

  it('cancels a booking via POST /v2/bookings/{uid}/cancel with the cancellation reason in the body', async () => {
    const fetchMock = mockFetch({ status: 'success' })
    const invocation: ConnectorInvocation = {
      source,
      capabilityName: 'bookings.cancel',
      args: { bookingUid: 'bk_abc', cancellationReason: 'attendee no longer available' },
      idempotencyKey: 'cancel_1',
    }

    const result = await calComConnector.executeMutation!(invocation)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe('/v2/bookings/bk_abc/cancel')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'cal-api-version': '2026-02-25' })
    expect(JSON.parse(String(init.body))).toEqual({ cancellationReason: 'attendee no longer available' })
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
