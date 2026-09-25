import { afterEach, describe, expect, it, vi } from 'vitest'
import { videoaskConnector } from '../src/connectors/adapters/videoask.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_videoask_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'videoask',
    label: 'videoask test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'videoask_token' },
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

describe('videoask forms.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v2/forms with the form body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'form_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await videoaskConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.create',
      args: { title: 'Hello', description: 'desc' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v2/forms')
    expect(requestBody).toMatchObject({ title: 'Hello', description: 'desc' })
    expect(result.status).toBe('committed')
  })
})

describe('videoask forms.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v2/forms/{formId} with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'form_9' })
    }))

    await videoaskConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.update',
      args: { formId: 'form_9', title: 'New title' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/v2/forms/form_9')
    expect(requestBody).toMatchObject({ formId: 'form_9', title: 'New title' })
  })
})

describe('videoask forms.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/forms/{formId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    }))

    const result = await videoaskConnector.executeMutation!({
      source: source(),
      capabilityName: 'forms.delete',
      args: { formId: 'form_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/forms/form_9')
    expect(result.status).toBe('committed')
  })
})

describe('videoask responses.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/forms/{formId}/responses/{responseId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse(null, { status: 204 })
    }))

    await videoaskConnector.executeMutation!({
      source: source(),
      capabilityName: 'responses.delete',
      args: { formId: 'form_9', responseId: 'resp_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v2/forms/form_9/responses/resp_42')
  })
})
