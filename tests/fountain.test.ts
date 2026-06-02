import { afterEach, describe, expect, it, vi } from 'vitest'
import { fountainConnector } from '../src/connectors/adapters/fountain.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_fountain_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'fountain',
    label: 'Fountain test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'fountain-secret' },
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

describe('fountain adapter manifest', () => {
  it('exposes the fountain kind under the calendar category with authoritative consistency', () => {
    expect(fountainConnector.manifest.kind).toBe('fountain')
    expect(fountainConnector.manifest.category).toBe('calendar')
    expect(fountainConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(fountainConnector.manifest.displayName).toBe('Fountain')
  })

  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = fountainConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('fountain api key')
  })

  it('covers applicants, openings, stages, interview sessions, advance, and reject', () => {
    const names = fountainConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'applicants.list',
        'applicants.get',
        'applicants.create',
        'applicants.update',
        'applicants.delete',
        'applicants.advance',
        'applicants.reject',
        'applicants.interviewSessions',
        'openings.list',
        'openings.get',
        'stages.list',
        'stages.get',
      ].sort(),
    )
  })

  it('splits capabilities correctly between reads and mutations', () => {
    const reads = fountainConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = fountainConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'applicants.list',
        'applicants.get',
        'applicants.interviewSessions',
        'openings.list',
        'openings.get',
        'stages.list',
        'stages.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'applicants.create',
        'applicants.update',
        'applicants.delete',
        'applicants.advance',
        'applicants.reject',
      ].sort(),
    )
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of fountainConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })

  it('marks the new applicants.advance and applicants.reject mutations as native-idempotency external effect', () => {
    for (const name of ['applicants.advance', 'applicants.reject']) {
      const cap = fountainConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('fountain applicants.advance', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs to /applicants/{id}/advance with the optional stage_id body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'app_1', current_stage_id: 'stage_2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fountainConnector.executeMutation!({
      source: source(),
      capabilityName: 'applicants.advance',
      args: { id: 'app_1', stage_id: 'stage_2' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toBe('https://api.fountain.com/v2/applicants/app_1/advance')
    expect(requestBody).toMatchObject({ stage_id: 'stage_2' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      fountainConnector.executeMutation!({
        source: source(),
        capabilityName: 'applicants.advance',
        args: { id: 'app_1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('fountain applicants.reject', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /applicants/{id}/reject with the rejection_reason in the body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'app_1', rejected: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fountainConnector.executeMutation!({
      source: source(),
      capabilityName: 'applicants.reject',
      args: {
        id: 'app_1',
        rejection_reason: 'Not a fit',
        send_rejection_email: true,
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.fountain.com/v2/applicants/app_1/reject')
    expect(requestBody).toMatchObject({
      rejection_reason: 'Not a fit',
      send_rejection_email: true,
    })
  })
})
