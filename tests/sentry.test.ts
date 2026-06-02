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
  it('declares kind, category, consistency model, and OAuth2 auth', () => {
    expect(sentryConnector.manifest.kind).toBe('sentry')
    expect(sentryConnector.manifest.category).toBe('other')
    expect(sentryConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(sentryConnector.manifest.auth.kind).toBe('oauth2')
  })

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

  it('exposes the documented issue / event / project / release / alert surface', () => {
    const names = sentryConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'alerts.create',
        'alerts.list',
        'events.get',
        'issues.assign',
        'issues.comments.create',
        'issues.comments.list',
        'issues.delete',
        'issues.events.latest',
        'issues.events.list',
        'issues.get',
        'issues.ignore',
        'issues.resolve',
        'issues.search',
        'issues.update',
        'organizations.list',
        'projects.get',
        'projects.list',
        'releases.create',
        'releases.delete',
        'releases.deploys.create',
        'releases.get',
        'releases.list',
        'releases.update',
        'teams.list',
      ].sort(),
    )
  })

  it('every mutation declares a CAS strategy and externalEffect, every read names a scope', () => {
    for (const cap of sentryConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(['native-idempotency', 'optimistic-read-verify', 'etag-if-match']).toContain(cap.cas)
        expect(cap.externalEffect).toBe(true)
      } else {
        const scopes = cap.requiredScopes ?? []
        expect(scopes.length).toBeGreaterThan(0)
      }
    }
  })

  it('the newly added write capabilities are native-idempotency + external effect', () => {
    const newCaps = ['issues.resolve', 'issues.ignore', 'issues.assign', 'alerts.create']
    for (const name of newCaps) {
      const cap = sentryConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} should be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('passes the shared manifest validator', () => {
    expect(validateConnectorManifest(sentryConnector.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('only ships read + mutation handlers when manifest declares them', () => {
    const hasReads = sentryConnector.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = sentryConnector.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(sentryConnector.executeRead)).toBe(hasReads)
    expect(Boolean(sentryConnector.executeMutation)).toBe(hasMutations)
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
