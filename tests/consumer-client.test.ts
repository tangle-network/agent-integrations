import { describe, expect, it, vi } from 'vitest'
import {
  createIntegrationHubClient,
  IntegrationHubClient,
  IntegrationHubRequestError,
} from '../src/consumer'
import type { IntegrationManifest, IntegrationManifestResolution } from '../src/runtime'

// ─── Fixtures ─────────────────────────────────────────────────────────

const SERVICE_AUTH = {
  mode: 'service' as const,
  serviceToken: 'svc_blueprint_test',
  serviceName: 'blueprint-agent',
}

function manifest(connectorId = 'github'): IntegrationManifest {
  return {
    id: `m-${connectorId}`,
    requirements: [
      { id: connectorId, connectorId, reason: 'test', mode: 'read' },
    ],
  }
}

function resolution(
  status: 'ready' | 'missing_connection',
  connectorId = 'github',
): IntegrationManifestResolution {
  const req = {
    requirement: { id: connectorId, connectorId, reason: 'test', mode: 'read' as const },
    status,
    missingScopes: [],
    missingActions: [],
    missingTriggers: [],
    message: status === 'ready' ? 'connected' : 'no connection',
    ...(status === 'ready'
      ? {
          connection: {
            id: `conn-${connectorId}`,
            owner: { type: 'user' as const, id: 'usr_1' },
            providerId: 'tangle-platform',
            connectorId,
            status: 'active' as const,
            grantedScopes: [],
            account: { id: 'gh_99', displayName: 'octocat' },
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        }
      : {}),
  }
  return {
    manifest: manifest(connectorId),
    owner: { type: 'user', id: 'usr_1' },
    ready: status === 'ready' ? [req] : [],
    missing: status === 'ready' ? [] : [req],
    optionalMissing: [],
  }
}

/** A fetch double that records every call and dispatches to a handler. */
function mockFetch(
  handler: (url: string, init: RequestInit, attempt: number) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: unknown }> = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const i = init ?? {}
    const headers = i.headers instanceof Headers ? i.headers : new Headers(i.headers)
    calls.push({
      url: String(input),
      method: i.method ?? 'GET',
      headers,
      body: typeof i.body === 'string' ? JSON.parse(i.body) : undefined,
    })
    return handler(String(input), i, calls.length)
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fail(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// ─── Constructor validation ───────────────────────────────────────────

describe('IntegrationHubClient — construction', () => {
  it('rejects a missing product', () => {
    expect(() =>
      createIntegrationHubClient({ product: '', auth: SERVICE_AUTH }),
    ).toThrow(/product is required/)
  })

  it('rejects service auth without a serviceToken or serviceName', () => {
    expect(() =>
      createIntegrationHubClient({
        product: 'blueprint-agent',
        auth: { mode: 'service', serviceToken: '', serviceName: 'blueprint-agent' },
      }),
    ).toThrow(/serviceToken/)
    expect(() =>
      createIntegrationHubClient({
        product: 'blueprint-agent',
        auth: { mode: 'service', serviceToken: 'svc_x', serviceName: '' },
      }),
    ).toThrow(/serviceName/)
  })

  it('rejects user-key auth without an apiKey', () => {
    expect(() =>
      createIntegrationHubClient({
        product: 'blueprint-agent',
        auth: { mode: 'user-key', apiKey: '' },
      }),
    ).toThrow(/apiKey/)
  })

  it('trims a trailing slash off the endpoint', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      endpoint: 'https://id.example.com/',
      fetchImpl: fn,
    })
    await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })
    expect(calls[0].url).toBe('https://id.example.com/v1/integrations/resolve-manifest')
  })
})

// ─── resolveManifest ──────────────────────────────────────────────────

describe('resolveManifest', () => {
  it('POSTs the manifest with the product + ownerUserId and unwraps data', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })

    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://id.tangle.tools/v1/integrations/resolve-manifest')
    expect(calls[0].body).toEqual({
      product: 'blueprint-agent',
      manifest: manifest(),
      ownerUserId: 'usr_1',
    })
    expect(result.ready).toHaveLength(1)
  })

  it('sends service-token auth headers', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })
    expect(calls[0].headers.get('authorization')).toBe('Bearer svc_blueprint_test')
    expect(calls[0].headers.get('x-service-name')).toBe('blueprint-agent')
    expect(calls[0].headers.get('x-platform-user-id')).toBe('usr_1')
  })

  it('lets a per-call product override the client default', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await client.resolveManifest({ userId: 'usr_1', manifest: manifest(), product: 'evals' })
    expect((calls[0].body as { product: string }).product).toBe('evals')
  })
})

// ─── checkConnector ───────────────────────────────────────────────────

describe('checkConnector', () => {
  it('reports connected=true and surfaces the connection when ready', async () => {
    const { fn } = mockFetch(() => ok(resolution('ready', 'github')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.checkConnector({ userId: 'usr_1', connectorId: 'github' })
    expect(result.connected).toBe(true)
    expect(result.connection?.connectorId).toBe('github')
    expect(result.connection?.account?.displayName).toBe('octocat')
  })

  it('reports connected=false with no connection when the requirement is missing', async () => {
    const { fn } = mockFetch(() => ok(resolution('missing_connection', 'github')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.checkConnector({ userId: 'usr_1', connectorId: 'github' })
    expect(result.connected).toBe(false)
    expect(result.connection).toBeUndefined()
    expect(result.resolution.status).toBe('missing_connection')
  })

  it('builds a single-requirement connectivity-check manifest', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready', 'tangle-id')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await client.checkConnector({
      userId: 'usr_1',
      connectorId: 'tangle-id',
      mode: 'read',
      requiredScopes: ['wallet:read'],
    })
    const body = calls[0].body as { manifest: IntegrationManifest }
    expect(body.manifest.id).toBe('connectivity-check:tangle-id')
    expect(body.manifest.requirements).toHaveLength(1)
    expect(body.manifest.requirements[0].requiredScopes).toEqual(['wallet:read'])
  })

  it('throws when the platform returns no resolution for the requirement', async () => {
    const empty: IntegrationManifestResolution = {
      manifest: manifest(),
      owner: { type: 'user', id: 'usr_1' },
      ready: [],
      missing: [],
      optionalMissing: [],
    }
    const { fn } = mockFetch(() => ok(empty))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.checkConnector({ userId: 'usr_1', connectorId: 'github' }),
    ).rejects.toMatchObject({ code: 'malformed_response' })
  })
})

// ─── createGrants / listGrants ────────────────────────────────────────

describe('createGrants', () => {
  it('POSTs grantee + manifest + ownerUserId and returns the grant list', async () => {
    const grants = [{ id: 'grant_1', connectorId: 'github' }]
    const { fn, calls } = mockFetch(() => ok({ grants }, 201))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.createGrants({
      userId: 'usr_1',
      grantee: { type: 'sandbox', id: 'sb-1' },
      manifest: manifest(),
      metadata: { source: 'preview' },
    })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://id.tangle.tools/v1/integrations/grants')
    expect(calls[0].body).toMatchObject({
      grantee: { type: 'sandbox', id: 'sb-1' },
      ownerUserId: 'usr_1',
      metadata: { source: 'preview' },
    })
    expect(result).toEqual(grants)
  })
})

describe('listGrants', () => {
  it('GETs without query params when no grantee filter is given', async () => {
    const { fn, calls } = mockFetch(() => ok({ grants: [] }))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await client.listGrants({ userId: 'usr_1' })
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url).toBe('https://id.tangle.tools/v1/integrations/grants')
  })

  it('encodes the grantee filter into query params', async () => {
    const { fn, calls } = mockFetch(() => ok({ grants: [] }))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await client.listGrants({ userId: 'usr_1', grantee: { type: 'sandbox', id: 'sb-1' } })
    expect(calls[0].url).toBe(
      'https://id.tangle.tools/v1/integrations/grants?granteeType=sandbox&granteeId=sb-1',
    )
  })
})

// ─── mintCapabilityBundle ─────────────────────────────────────────────

describe('mintCapabilityBundle', () => {
  it('requires a manifestId or a non-empty grantIds', async () => {
    const { fn } = mockFetch(() => ok({}))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.mintCapabilityBundle({ userId: 'usr_1', subject: { type: 'sandbox', id: 'sb-1' } }),
    ).rejects.toThrow(/manifestId or a non-empty grantIds/)
    await expect(
      client.mintCapabilityBundle({
        userId: 'usr_1',
        subject: { type: 'sandbox', id: 'sb-1' },
        grantIds: [],
      }),
    ).rejects.toThrow(/manifestId or a non-empty grantIds/)
  })

  it('POSTs the subject + manifestId and returns the bundle + env', async () => {
    const data = {
      bundle: { manifestId: 'm-github', subject: { type: 'sandbox', id: 'sb-1' }, capabilities: [] },
      env: { TANGLE_INTEGRATION_BUNDLE: 'eyJ...' },
    }
    const { fn, calls } = mockFetch(() => ok(data))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.mintCapabilityBundle({
      userId: 'usr_1',
      subject: { type: 'sandbox', id: 'sb-1' },
      manifestId: 'm-github',
      ttlMs: 60_000,
    })
    expect(calls[0].url).toBe('https://id.tangle.tools/v1/integrations/capabilities/bundle')
    expect(calls[0].body).toEqual({
      subject: { type: 'sandbox', id: 'sb-1' },
      manifestId: 'm-github',
      ttlMs: 60_000,
    })
    expect(result.env.TANGLE_INTEGRATION_BUNDLE).toBe('eyJ...')
  })
})

// ─── runHealthchecks ──────────────────────────────────────────────────

describe('runHealthchecks', () => {
  it('POSTs ownerUserId and returns the healthcheck list', async () => {
    const healthchecks = [{ connectionId: 'conn-1', status: 'healthy' }]
    const { fn, calls } = mockFetch(() => ok({ healthchecks }))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.runHealthchecks({ userId: 'usr_1' })
    expect(calls[0].url).toBe('https://id.tangle.tools/v1/integrations/healthchecks/run')
    expect(calls[0].body).toEqual({ ownerUserId: 'usr_1' })
    expect(result).toEqual(healthchecks)
  })
})

// ─── User-key auth mode ───────────────────────────────────────────────

describe('user-key auth mode', () => {
  it('sends the sk-tan key as the bearer and omits the service/impersonation headers', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: { mode: 'user-key', apiKey: 'sk-tan-userkey' },
      fetchImpl: fn,
    })
    await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })
    expect(calls[0].headers.get('authorization')).toBe('Bearer sk-tan-userkey')
    expect(calls[0].headers.get('x-service-name')).toBeNull()
    expect(calls[0].headers.get('x-platform-user-id')).toBeNull()
  })
})

// ─── Error handling ───────────────────────────────────────────────────

describe('error handling', () => {
  it('throws IntegrationHubRequestError with the platform code on a structured 4xx', async () => {
    const { fn } = mockFetch(() => fail(409, 'missing_connection', 'GitHub is not connected'))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.resolveManifest({ userId: 'usr_1', manifest: manifest() }),
    ).rejects.toBeInstanceOf(IntegrationHubRequestError)
    await expect(
      client.resolveManifest({ userId: 'usr_1', manifest: manifest() }),
    ).rejects.toMatchObject({ status: 409, code: 'missing_connection', retryable: false })
  })

  it('preserves a Hono plain-text rejection body (the impersonate-scope 403)', async () => {
    const { fn } = mockFetch(
      () =>
        new Response(
          'Service "blueprint-agent" lacks the "impersonate:user" scope required to send X-Platform-User-Id',
          { status: 403 },
        ),
    )
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.resolveManifest({ userId: 'usr_1', manifest: manifest() }),
    ).rejects.toThrow(/impersonate:user/)
  })

  it('rejects an invalid userId client-side without issuing a request', async () => {
    const { fn, calls } = mockFetch(() => ok(resolution('ready')))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.resolveManifest({ userId: 'bad id with spaces', manifest: manifest() }),
    ).rejects.toMatchObject({ code: 'invalid_user_id' })
    expect(calls).toHaveLength(0)
  })
})

// ─── Retry behaviour ──────────────────────────────────────────────────

describe('retry behaviour', () => {
  it('retries a transient 503 and succeeds on the second attempt', async () => {
    const { fn, calls } = mockFetch((_url, _init, attempt) =>
      attempt === 1 ? fail(503, 'unavailable', 'try later') : ok(resolution('ready')),
    )
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    const result = await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })
    expect(calls).toHaveLength(2)
    expect(result.ready).toHaveLength(1)
  })

  it('retries a network failure', async () => {
    let attempt = 0
    const fn = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new Error('econnreset')
      return ok(resolution('ready'))
    })
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn as unknown as typeof fetch,
    })
    const result = await client.resolveManifest({ userId: 'usr_1', manifest: manifest() })
    expect(attempt).toBe(2)
    expect(result.ready).toHaveLength(1)
  })

  it('does NOT retry a deterministic 4xx', async () => {
    const { fn, calls } = mockFetch(() => fail(400, 'VALIDATION_ERROR', 'bad manifest'))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
    })
    await expect(
      client.resolveManifest({ userId: 'usr_1', manifest: manifest() }),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(1)
  })

  it('throws after exhausting retries on a persistent 503', async () => {
    const { fn, calls } = mockFetch(() => fail(503, 'unavailable', 'down'))
    const client = createIntegrationHubClient({
      product: 'blueprint-agent',
      auth: SERVICE_AUTH,
      fetchImpl: fn,
      maxAttempts: 3,
    })
    await expect(
      client.resolveManifest({ userId: 'usr_1', manifest: manifest() }),
    ).rejects.toMatchObject({ status: 503, retryable: true })
    expect(calls).toHaveLength(3)
  })
})

// ─── Type-surface smoke ───────────────────────────────────────────────

describe('exports', () => {
  it('exposes the class and the factory', () => {
    expect(typeof IntegrationHubClient).toBe('function')
    expect(typeof createIntegrationHubClient).toBe('function')
    expect(
      createIntegrationHubClient({ product: 'x', auth: SERVICE_AUTH }),
    ).toBeInstanceOf(IntegrationHubClient)
  })
})
