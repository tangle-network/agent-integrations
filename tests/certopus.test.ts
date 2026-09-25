import { afterEach, describe, expect, it, vi } from 'vitest'
import { certopusConnector } from '../src/connectors/adapters/certopus.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_certopus_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'certopus',
    label: 'Certopus test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'certopus-secret' },
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

describe('certopus credentials.revoke', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /credentials/{id}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ revoked: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await certopusConnector.executeMutation!({
      source: source(),
      capabilityName: 'credentials.revoke',
      args: { id: 'cred_42' },
      idempotencyKey: 'k-revoke-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.certopus.com/v1/credentials/cred_42')
    expect(result.status).toBe('committed')
  })
})

describe('certopus credentials.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /credentials/{id} with the updated fields in the body', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'cred_42', updated: true })
      }),
    )
    const result = await certopusConnector.executeMutation!({
      source: source(),
      capabilityName: 'credentials.update',
      args: { id: 'cred_42', fields: { name: 'Drew' }, generate: true, publish: true },
      idempotencyKey: 'k-update-1',
    })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toBe('https://api.certopus.com/v1/credentials/cred_42')
    expect(capturedBody).toEqual({ fields: { name: 'Drew' }, generate: true, publish: true })
    expect(result.status).toBe('committed')
  })
})

describe('certopus events.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /events with the supplied payload', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'evt_1' })
      }),
    )
    const result = await certopusConnector.executeMutation!({
      source: source(),
      capabilityName: 'events.create',
      args: {
        organisation: 'org_1',
        title: 'Hackathon 2026',
        description: 'Annual hackathon',
        startDate: '2026-07-01',
        endDate: '2026-07-03',
      },
      idempotencyKey: 'k-event-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.certopus.com/v1/events')
    expect(capturedBody).toEqual({
      organisation: 'org_1',
      title: 'Hackathon 2026',
      description: 'Annual hackathon',
      startDate: '2026-07-01',
      endDate: '2026-07-03',
    })
    expect(result.status).toBe('committed')
  })
})
