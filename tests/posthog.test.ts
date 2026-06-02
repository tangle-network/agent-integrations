import { afterEach, describe, expect, it, vi } from 'vitest'
import { posthogConnector } from '../src/connectors/adapters/posthog.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_posthog_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'posthog',
    label: 'posthog test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { apiUrl: 'https://app.posthog.com' },
    credentials: { kind: 'api-key', apiKey: 'posthog_secret' },
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

describe('posthog adapter manifest', () => {
  it('classifies itself as the database category and exposes the posthog kind', () => {
    expect(posthogConnector.manifest.kind).toBe('posthog')
    expect(posthogConnector.manifest.category).toBe('database')
    expect(posthogConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = posthogConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers events, projects, cohorts, feature-flags, annotations, and insights', () => {
    const names = posthogConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'events.create',
        'projects.create',
        'projects.list',
        'projects.get',
        'cohorts.list',
        'cohorts.create',
        'feature-flags.list',
        'feature-flags.create',
        'feature-flags.update',
        'feature-flags.delete',
        'annotations.create',
        'insights.create',
      ].sort(),
    )
    const reads = posthogConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = posthogConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['cohorts.list', 'feature-flags.list', 'projects.get', 'projects.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'events.create',
        'feature-flags.create',
        'feature-flags.update',
        'feature-flags.delete',
        'cohorts.create',
        'annotations.create',
        'insights.create',
        'projects.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of [
      'feature-flags.update',
      'feature-flags.delete',
      'cohorts.create',
      'annotations.create',
      'insights.create',
    ]) {
      const cap = posthogConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('posthog feature-flags.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes the feature flag under the project', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 9, active: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await posthogConnector.executeMutation!({
      source: source(),
      capabilityName: 'feature-flags.update',
      args: { projectId: '42', featureFlagId: '9', active: false },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://app.posthog.com/api/projects/42/feature_flags/9')
    expect(requestBody).toMatchObject({ active: false })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      posthogConnector.executeMutation!({
        source: source(),
        capabilityName: 'feature-flags.update',
        args: { projectId: '42', featureFlagId: '9' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('posthog feature-flags.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the feature flag under the project', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await posthogConnector.executeMutation!({
      source: source(),
      capabilityName: 'feature-flags.delete',
      args: { projectId: '42', featureFlagId: '9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://app.posthog.com/api/projects/42/feature_flags/9')
    expect(result.status).toBe('committed')
  })
})

describe('posthog cohorts.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the cohort to /api/projects/{projectId}/cohorts', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 123, name: 'High Value' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await posthogConnector.executeMutation!({
      source: source(),
      capabilityName: 'cohorts.create',
      args: { projectId: '42', name: 'High Value' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://app.posthog.com/api/projects/42/cohorts')
    expect(requestBody).toMatchObject({ name: 'High Value' })
    expect(result.status).toBe('committed')
  })
})

describe('posthog annotations.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the annotation to /api/projects/{projectId}/annotations', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 7 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await posthogConnector.executeMutation!({
      source: source(),
      capabilityName: 'annotations.create',
      args: { projectId: '42', content: 'Release 2.0', date_marker: '2026-01-01T00:00:00Z' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://app.posthog.com/api/projects/42/annotations')
    expect(requestBody).toMatchObject({ content: 'Release 2.0', date_marker: '2026-01-01T00:00:00Z' })
  })
})

describe('posthog insights.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the insight to /api/projects/{projectId}/insights', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ id: 11, name: 'DAU' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await posthogConnector.executeMutation!({
      source: source(),
      capabilityName: 'insights.create',
      args: { projectId: '42', name: 'DAU' },
      idempotencyKey: 'k-1',
    })

    expect(requestUrl).toBe('https://app.posthog.com/api/projects/42/insights')
    expect(requestBody).toMatchObject({ name: 'DAU' })
  })
})
