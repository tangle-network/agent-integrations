import { afterEach, describe, expect, it, vi } from 'vitest'
import { workableConnector } from '../src/connectors/adapters/workable.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_workable_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'workable',
    label: 'workable test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'workable_secret' },
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

describe('workable adapter manifest', () => {
  it('classifies itself as the crm category and exposes the workable kind', () => {
    expect(workableConnector.manifest.kind).toBe('workable')
    expect(workableConnector.manifest.category).toBe('crm')
    expect(workableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = workableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the read action set plus the new write-side mutations', () => {
    const names = workableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'candidates.get',
        'candidates.move',
        'candidates.rate',
        'candidates.comment',
        'candidates.create',
        'candidates.disqualify',
        'candidates.revert',
        'jobs.get',
        'jobs.stages',
        'jobs.list',
        'jobs.publish',
        'members.list',
        'offers.create',
      ].sort(),
    )
    const reads = workableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = workableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['candidates.get', 'jobs.get', 'jobs.stages', 'jobs.list', 'members.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'candidates.move',
        'candidates.rate',
        'candidates.comment',
        'candidates.create',
        'candidates.disqualify',
        'candidates.revert',
        'jobs.publish',
        'offers.create',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = [
      'candidates.create',
      'candidates.disqualify',
      'candidates.revert',
      'jobs.publish',
      'offers.create',
    ]
    for (const name of expected) {
      const cap = workableConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('workable candidates.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/jobs/{shortcode}/candidates with the candidate envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ candidate: { id: 'cand_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await workableConnector.executeMutation!({
      source: source(),
      capabilityName: 'candidates.create',
      args: {
        shortcode: 'JOB-ABC',
        candidate: { name: 'Jane Doe', email: 'jane@example.com' },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.workable.com/v1/jobs/JOB-ABC/candidates')
    expect(requestBody).toMatchObject({ candidate: { name: 'Jane Doe', email: 'jane@example.com' } })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      workableConnector.executeMutation!({
        source: source(),
        capabilityName: 'candidates.create',
        args: { shortcode: 'JOB-X', candidate: { name: 'A' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('workable candidates.disqualify', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/candidates/{id}/disqualify', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ disqualified: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await workableConnector.executeMutation!({
      source: source(),
      capabilityName: 'candidates.disqualify',
      args: { id: 'cand_99', disqualification_reason_id: 'reason_1' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.workable.com/v1/candidates/cand_99/disqualify')
  })
})

describe('workable candidates.revert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/candidates/{id}/revert', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ reverted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await workableConnector.executeMutation!({
      source: source(),
      capabilityName: 'candidates.revert',
      args: { id: 'cand_42' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.workable.com/v1/candidates/cand_42/revert')
  })
})

describe('workable jobs.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/jobs/{shortcode}/publish', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ published: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await workableConnector.executeMutation!({
      source: source(),
      capabilityName: 'jobs.publish',
      args: { shortcode: 'JOB-PUB' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.workable.com/v1/jobs/JOB-PUB/publish')
  })
})

describe('workable offers.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/candidates/{id}/offer with the offer envelope', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ offer: { id: 'offer_1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await workableConnector.executeMutation!({
      source: source(),
      capabilityName: 'offers.create',
      args: {
        id: 'cand_7',
        offer: { salary: 100000, currency: 'USD', employment_type: 'full_time' },
      },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://api.workable.com/v1/candidates/cand_7/offer')
    expect(requestBody).toMatchObject({
      offer: { salary: 100000, currency: 'USD', employment_type: 'full_time' },
    })
  })
})
