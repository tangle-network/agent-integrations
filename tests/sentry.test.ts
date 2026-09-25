import { afterEach, describe, expect, it, vi } from 'vitest'
import { sentryConnector } from '../src/connectors/adapters/sentry'
import type { ResolvedDataSource } from '../src/connectors/types'
import { validateConnectorManifest } from '../src/connectors/types'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sentry_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sentry',
    label: 'sentry test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'sentry_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('sentry adapter', () => {
  it('uses the real Sentry OAuth endpoints documented at docs.sentry.io', () => {
    const auth = sentryConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://sentry.io/oauth/authorize/')
    expect(auth.tokenUrl).toBe('https://sentry.io/oauth/token/')
    expect(auth.clientIdEnv).toBe('SENTRY_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SENTRY_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(
      expect.arrayContaining([
        'org:read',
        'project:read',
        'project:releases',
        'event:read',
        'event:write',
        'event:admin',
      ]),
    )
  })

})

describe('sentry issues.resolve', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs status=resolved against /issues/{id}/', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: '1234567890', status: 'resolved' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sentryConnector.executeMutation!({
      source: source(),
      capabilityName: 'issues.resolve',
      args: { issueId: '1234567890' },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/0/issues/1234567890/')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.status).toBe('resolved')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      sentryConnector.executeMutation!({
        source: source(),
        capabilityName: 'issues.resolve',
        args: { issueId: '1234567890' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('sentry issues.ignore', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs status=ignored against /issues/{id}/', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: '1234567890', status: 'ignored' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sentryConnector.executeMutation!({
      source: source(),
      capabilityName: 'issues.ignore',
      args: { issueId: '1234567890' },
      idempotencyKey: 'k-1',
    })
    expect(String(requestUrl)).toContain('/api/0/issues/1234567890/')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.status).toBe('ignored')
  })
})

describe('sentry issues.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs assignedTo against /issues/{id}/', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: '1234567890', assignedTo: { username: 'alice' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sentryConnector.executeMutation!({
      source: source(),
      capabilityName: 'issues.assign',
      args: { issueId: '1234567890', assignedTo: 'alice' },
      idempotencyKey: 'k-1',
    })
    expect(String(requestUrl)).toContain('/api/0/issues/1234567890/')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.assignedTo).toBe('alice')
  })
})

describe('sentry alerts.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /projects/{org}/{project}/rules/', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse([{ id: 'rule_1', name: 'P0 errors' }])
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sentryConnector.executeRead!({
      source: source(),
      capabilityName: 'alerts.list',
      args: { organizationSlug: 'acme', projectSlug: 'web' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/api/0/projects/acme/web/rules/')
    expect(Array.isArray(result.data)).toBe(true)
  })
})

describe('sentry alerts.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /projects/{org}/{project}/rules/ with the alert fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ id: 'rule_99', name: 'P0 errors' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sentryConnector.executeMutation!({
      source: source(),
      capabilityName: 'alerts.create',
      args: {
        organizationSlug: 'acme',
        projectSlug: 'web',
        fields: {
          name: 'P0 errors',
          conditions: [{ id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition' }],
          actions: [{ id: 'sentry.rules.actions.notify_event.NotifyEventAction' }],
          actionMatch: 'all',
          frequency: 30,
        },
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/0/projects/acme/web/rules/')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.name).toBe('P0 errors')
    expect(parsed.actionMatch).toBe('all')
  })
})
