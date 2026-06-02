import { afterEach, describe, expect, it, vi } from 'vitest'
import { pipedreamConnector } from '../src/connectors/adapters/pipedream.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_pd_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'pipedream',
    label: 'Pipedream test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'pd_secret' },
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

describe('pipedream adapter manifest', () => {
  it('exposes the pipedream kind in the other category', () => {
    expect(pipedreamConnector.manifest.kind).toBe('pipedream')
    expect(pipedreamConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (bearer token from account settings)', () => {
    expect(pipedreamConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers workflows, sources, http-trigger, subscription, and write-side surfaces', () => {
    const names = pipedreamConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.list',
        'workflows.get',
        'workflows.deploy',
        'workflows.disable',
        'sources.list',
        'sources.events',
        'sources.create',
        'http.trigger',
        'subscriptions.create',
        'subscriptions.delete',
      ].sort(),
    )
  })

  it('marks every new mutation as native-idempotency + externalEffect', () => {
    const writeSide = [
      'workflows.deploy',
      'workflows.disable',
      'subscriptions.delete',
      'sources.create',
    ]
    for (const name of writeSide) {
      const cap = pipedreamConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('pipedream workflows.deploy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/workflows/{workflowId}/deploy', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ id: 'dep_1' })
      }),
    )
    const result = await pipedreamConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.deploy',
      args: { workflowId: 'p_abc' },
      idempotencyKey: 'idemp-dep-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.pipedream.com/v1/workflows/p_abc/deploy')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      pipedreamConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflows.deploy',
        args: { workflowId: 'p_abc' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('pipedream workflows.disable', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs {active:false} to /v1/workflows/{workflowId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'p_abc', active: false })
      }),
    )
    const result = await pipedreamConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.disable',
      args: { workflowId: 'p_abc' },
      idempotencyKey: 'idemp-dis-1',
    })
    expect(capturedMethod).toBe('PUT')
    expect(capturedUrl).toBe('https://api.pipedream.com/v1/workflows/p_abc')
    expect(capturedBody).toMatchObject({ active: false })
    expect(result.status).toBe('committed')
  })
})

describe('pipedream subscriptions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/subscriptions with emitter/listener query', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return new Response(null, { status: 204 })
      }),
    )
    const result = await pipedreamConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscriptions.delete',
      args: { emitterId: 'em_1', listenerId: 'li_2' },
      idempotencyKey: 'idemp-subdel-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/v1/subscriptions')
    expect(capturedUrl).toContain('emitter_id=em_1')
    expect(capturedUrl).toContain('listener_id=li_2')
    expect(result.status).toBe('committed')
  })
})

describe('pipedream sources.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/sources with the componentId mapped to component_id', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'dc_abc', component_id: 'sc_xyz' })
      }),
    )
    const result = await pipedreamConnector.executeMutation!({
      source: source(),
      capabilityName: 'sources.create',
      args: { componentId: 'sc_xyz' },
      idempotencyKey: 'idemp-srcc-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.pipedream.com/v1/sources')
    expect(capturedBody).toMatchObject({ component_id: 'sc_xyz' })
    expect(result.status).toBe('committed')
  })
})
