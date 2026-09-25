import { afterEach, describe, expect, it, vi } from 'vitest'
import { opnformConnector } from '../src/connectors/adapters/opnform.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_opnform_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'opnform',
    label: 'Opnform test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'opnform_secret' },
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

describe('opnform forms.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /api/v1/forms with title + properties', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(String(init.body)) : null
      return jsonResponse({ id: 'form_new' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await opnformConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.create',
      args: { title: 'Feedback', properties: [{ name: 'email', type: 'email' }] },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/forms')
    expect(requestBody).toMatchObject({ title: 'Feedback' })
  })
})

describe('opnform forms.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /api/v1/forms/{formId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'form_abc' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await opnformConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.update',
      args: { formId: 'form_abc', title: 'Renamed' },
      idempotencyKey: 'k-2',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('/api/v1/forms/form_abc')
  })
})

describe('opnform forms.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/forms/{formId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await opnformConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.delete',
      args: { formId: 'form_abc' },
      idempotencyKey: 'k-3',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/forms/form_abc')
  })
})

describe('opnform submissions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/v1/forms/{formId}/submissions/{submissionId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await opnformConnector.executeMutation!({
      source: source(),
      capabilityName: 'submissions.delete',
      args: { formId: 'form_abc', submissionId: 'sub_xyz' },
      idempotencyKey: 'k-4',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v1/forms/form_abc/submissions/sub_xyz')
  })
})
