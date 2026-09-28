import { afterEach, describe, expect, it, vi } from 'vitest'
import { vlmRunConnector } from '../src/connectors/adapters/vlm-run.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vlmrun_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vlm-run',
    label: 'VLM Run test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'vlm_secret' },
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

describe('vlm-run adapter manifest', () => {
  it('marks file mutations as mutations and jobs.list as a read', () => {
    const byName = new Map(vlmRunConnector.manifest.capabilities.map((c) => [c.name, c]))
    expect(byName.get('files.upload')?.class).toBe('mutation')
    expect(byName.get('files.delete')?.class).toBe('mutation')
    expect(byName.get('jobs.cancel')?.class).toBe('mutation')
    expect(byName.get('jobs.list')?.class).toBe('read')
  })
})

describe('vlm-run files.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the upload payload to /v1/files', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? String(init.body) : undefined
      return jsonResponse({ id: 'file_123' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vlmRunConnector.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: { filename: 'invoice.pdf', url: 'https://example.com/invoice.pdf' },
      idempotencyKey: 'k-upload-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/files')
    expect(requestBody).toContain('invoice.pdf')
  })
})

describe('vlm-run files.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/files/{fileId} and accepts 204', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vlmRunConnector.executeMutation!({
      source: source(),
      capabilityName: 'files.delete',
      args: { fileId: 'file_xyz' },
      idempotencyKey: 'k-del-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/files/file_xyz')
  })
})

describe('vlm-run jobs.list', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /v1/jobs and round-trips filter query params', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ jobs: [], nextCursor: null })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vlmRunConnector.executeRead!({
      source: source(),
      capabilityName: 'jobs.list',
      args: { status: 'running', limit: 25 },
      idempotencyKey: 'k-jobs-list',
    })

    expect((result.data as { jobs: unknown[] }).jobs).toEqual([])
    expect(requestMethod).toBe('GET')
    expect(String(requestUrl)).toContain('/v1/jobs')
    expect(String(requestUrl)).toContain('status=running')
    expect(String(requestUrl)).toContain('limit=25')
  })
})

describe('vlm-run jobs.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/jobs/{jobId}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'job_1', status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vlmRunConnector.executeMutation!({
      source: source(),
      capabilityName: 'jobs.cancel',
      args: { jobId: 'job_1' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/jobs/job_1/cancel')
  })
})
