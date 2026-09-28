import { afterEach, describe, expect, it, vi } from 'vitest'
import { formstackConnector } from '../src/connectors/adapters/formstack.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_formstack_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'formstack',
    label: 'Formstack test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'formstack-token' },
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

describe('formstack forms.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /form.json with the body fields populated', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'form_42', name: 'Contact Us' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await formstackConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.create',
      args: { name: 'Contact Us', folder: 'fld_1', language: 'en' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://www.formstack.com/api/v2/form.json')
    expect(requestBody).toMatchObject({ name: 'Contact Us', folder: 'fld_1', language: 'en' })
  })
})

describe('formstack submissions.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /submission/{id}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ success: 1 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await formstackConnector.executeMutation!({
      source: source(),
      capabilityName: 'submissions.delete',
      args: { submissionId: 'sub_99' },
      idempotencyKey: 'k-2',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://www.formstack.com/api/v2/submission/sub_99.json')
  })

  it('rejects when submissionId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      formstackConnector.executeMutation!({
        source: source(),
        capabilityName: 'submissions.delete',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/submissionId/)
  })
})
