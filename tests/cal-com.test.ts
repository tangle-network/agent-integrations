import { afterEach, describe, expect, it, vi } from 'vitest'
import { calCom, calComConnector } from '../src/connectors/adapters/cal-com.js'
import {
  createCredentialBackedAdapterProvider,
  createConnectorAdapterProvider,
  InMemoryConnectionStore,
  InMemoryIntegrationSecretStore,
  type IntegrationConnection,
} from '../src/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_cal_com_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'cal-com',
    label: 'Cal.com test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'cal_token' },
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

describe('cal-com adapter manifest', () => {
  it('exposes the cal-com kind in the calendar category', () => {
    expect(calComConnector.manifest.kind).toBe('cal-com')
    expect(calComConnector.manifest.category).toBe('calendar')
  })

  it('uses the approved public-client OAuth contract', () => {
    const auth = calComConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected OAuth2 auth')
    expect(auth.clientIdEnv).toBe('CALCOM_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBeUndefined()
    expect(auth.pkce).toBe('required')
    expect(auth.tokenClientAuthMethod).toBe('none')
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const caps = calComConnector.manifest.capabilities
    const targets = ['event-types.create', 'event-types.delete', 'schedules.create']
    for (const name of targets) {
      const cap = caps.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('cal-com public-client credential lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refreshes an expired secret, persists it, and executes with the fresh token', async () => {
    const now = new Date('2026-08-10T18:30:00.000Z')
    const secretRef = { provider: 'first-party', id: 'secret_cal_com' }
    const connection: IntegrationConnection = {
      id: 'conn_cal_com',
      owner: { type: 'user', id: 'user_42' },
      providerId: 'first-party',
      connectorId: 'cal-com',
      status: 'active',
      grantedScopes: ['PROFILE_READ'],
      secretRef,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() - 1_000).toISOString(),
    }
    const secrets = new InMemoryIntegrationSecretStore()
    const connections = new InMemoryConnectionStore()
    await secrets.put(secretRef, {
      kind: 'oauth2',
      accessToken: 'expired_access',
      refreshToken: 'refresh_public',
      expiresAt: now.getTime() - 1_000,
    })
    await connections.put(connection)

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.cal.com/v2/auth/oauth2/token') {
        const headers = init?.headers as Record<string, string>
        const body = init?.body as URLSearchParams
        expect(headers.authorization).toBeUndefined()
        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('client_id')).toBe('cal_public_client')
        expect(body.get('refresh_token')).toBe('refresh_public')
        expect(body.has('client_secret')).toBe(false)
        return Response.json({ access_token: 'fresh_access', expires_in: 3600 })
      }
      expect(String(url)).toBe('https://api.cal.com/v2/me')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer fresh_access')
      return Response.json({ status: 'success', data: { id: 42 } })
    }) as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    const adapter = calCom({
      clientId: 'cal_public_client',
      fetchImpl,
      now: () => now.getTime(),
    })
    const provider = createCredentialBackedAdapterProvider({
      adapters: [adapter],
      secrets,
      connections,
      now: () => now,
    })

    const result = await provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'me.get',
      input: {},
    })

    expect(result).toMatchObject({ ok: true, action: 'me.get' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(await secrets.get(secretRef)).toEqual({
      kind: 'oauth2',
      accessToken: 'fresh_access',
      refreshToken: 'refresh_public',
      expiresAt: now.getTime() + 3_600_000,
    })
    expect(await connections.get(connection.id)).toMatchObject({
      status: 'active',
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    })
  })

  it('refreshes and persists through the production executor-style provider path', async () => {
    const now = new Date('2026-08-10T18:30:00.000Z')
    const rotated: unknown[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.cal.com/v2/auth/oauth2/token') {
        const body = init?.body as URLSearchParams
        expect(body.get('client_id')).toBe('cal_public_client')
        expect(body.has('client_secret')).toBe(false)
        return Response.json({ access_token: 'fresh_access', expires_in: 3600 })
      }
      expect(String(url)).toBe('https://api.cal.com/v2/me')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer fresh_access')
      return Response.json({ status: 'success', data: { id: 42 } })
    }) as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    const adapter = calCom({
      clientId: 'cal_public_client',
      fetchImpl,
      now: () => now.getTime(),
    })
    const provider = createConnectorAdapterProvider({
      adapters: [adapter],
      resolveDataSource: () => source({
        id: 'conn_cal_com_executor',
        credentials: {
          kind: 'oauth2',
          accessToken: 'expired_access',
          refreshToken: 'refresh_public',
          expiresAt: now.getTime() - 1_000,
        },
      }),
      onCredentialsRotated: async ({ credentials }) => {
        rotated.push(credentials)
      },
    })
    const connection: IntegrationConnection = {
      id: 'conn_cal_com_executor',
      owner: { type: 'system', id: 'hub' },
      providerId: 'first-party',
      connectorId: 'cal-com',
      status: 'active',
      grantedScopes: ['PROFILE_READ'],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }

    await expect(provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'me.get',
      input: {},
    })).resolves.toMatchObject({ ok: true, action: 'me.get' })
    expect(rotated).toEqual([{
      kind: 'oauth2',
      accessToken: 'fresh_access',
      refreshToken: 'refresh_public',
      expiresAt: now.getTime() + 3_600_000,
    }])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent executor-style refreshes for one connection', async () => {
    const now = new Date('2026-08-10T18:30:00.000Z')
    let releaseRefresh!: () => void
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let tokenRequests = 0
    let apiRequests = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.cal.com/v2/auth/oauth2/token') {
        tokenRequests += 1
        await refreshGate
        return Response.json({ access_token: 'fresh_access', expires_in: 3600 })
      }
      apiRequests += 1
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer fresh_access')
      return Response.json({ status: 'success', data: { id: 42 } })
    }) as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    const adapter = calCom({
      clientId: 'cal_public_client',
      fetchImpl,
      now: () => now.getTime(),
    })
    const provider = createConnectorAdapterProvider({
      adapters: [adapter],
      resolveDataSource: () => source({
        id: 'conn_cal_com_shared',
        credentials: {
          kind: 'oauth2',
          accessToken: 'expired_access',
          refreshToken: 'refresh_public',
          expiresAt: now.getTime() - 1_000,
        },
      }),
      onCredentialsRotated: async () => {},
    })
    const connection: IntegrationConnection = {
      id: 'conn_cal_com_shared',
      owner: { type: 'system', id: 'hub' },
      providerId: 'first-party',
      connectorId: 'cal-com',
      status: 'active',
      grantedScopes: ['PROFILE_READ'],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const invoke = () => provider.invokeAction(connection, {
      connectionId: connection.id,
      action: 'me.get',
      input: {},
    })

    const first = invoke()
    const second = invoke()
    await vi.waitFor(() => expect(tokenRequests).toBe(1))
    releaseRefresh()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(tokenRequests).toBe(1)
    expect(apiRequests).toBe(2)
  })

  it('never shares a refresh result across different source ids', async () => {
    const now = new Date('2026-08-10T18:30:00.000Z')
    let tokenRequests = 0
    let apiRequests = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://api.cal.com/v2/auth/oauth2/token') {
        tokenRequests += 1
        return Response.json({ access_token: `fresh_access_${tokenRequests}`, expires_in: 3600 })
      }
      apiRequests += 1
      expect((init?.headers as Record<string, string>).authorization).toMatch(/^Bearer fresh_access_[12]$/)
      return Response.json({ status: 'success', data: { id: 42 } })
    }) as typeof fetch
    vi.stubGlobal('fetch', fetchImpl)
    const adapter = calCom({
      clientId: 'cal_public_client',
      fetchImpl,
      now: () => now.getTime(),
    })
    const provider = createConnectorAdapterProvider({
      adapters: [adapter],
      resolveDataSource: (connection) => source({
        id: connection.id,
        credentials: {
          kind: 'oauth2',
          accessToken: `expired_${connection.id}`,
          refreshToken: `refresh_${connection.id}`,
          expiresAt: now.getTime() - 1_000,
        },
      }),
      onCredentialsRotated: async () => {},
    })
    const connection = (id: string): IntegrationConnection => ({
      id,
      owner: { type: 'system', id: 'hub' },
      providerId: 'first-party',
      connectorId: 'cal-com',
      status: 'active',
      grantedScopes: ['PROFILE_READ'],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    const invoke = (value: IntegrationConnection) => provider.invokeAction(value, {
      connectionId: value.id,
      action: 'me.get',
      input: {},
    })

    await expect(Promise.all([
      invoke(connection('conn_cal_tenant_a')),
      invoke(connection('conn_cal_tenant_b')),
    ])).resolves.toHaveLength(2)
    expect(tokenRequests).toBe(2)
    expect(apiRequests).toBe(2)
  })
})

describe('cal-com event-types.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/event-types with title/slug/lengthInMinutes body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 99 })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'event-types.create',
      args: {
        title: 'Intro Call',
        slug: 'intro',
        lengthInMinutes: 30,
        description: 'Quick chat',
        locations: [{ type: 'integrations:google:meet' }],
        bookingFields: [],
        disableGuests: false,
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/event-types')
    expect(requestBody).toMatchObject({ title: 'Intro Call', slug: 'intro', lengthInMinutes: 30 })
    expect(result.status).toBe('committed')
  })
})

describe('cal-com event-types.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v2/event-types/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ ok: true })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'event-types.delete',
      args: { eventTypeId: '77' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/event-types/77')
    expect(result.status).toBe('committed')
  })
})

describe('cal-com schedules.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/schedules with the schedule body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 1 })
      }),
    )
    const result = await calComConnector.executeMutation!({
      source: source(),
      capabilityName: 'schedules.create',
      args: {
        name: 'Weekday hours',
        timeZone: 'America/Los_Angeles',
        isDefault: true,
        availability: [{ days: ['Monday'], startTime: '09:00', endTime: '17:00' }],
        overrides: [],
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/schedules')
    expect(requestBody).toMatchObject({ name: 'Weekday hours', timeZone: 'America/Los_Angeles' })
    expect(result.status).toBe('committed')
  })
})
