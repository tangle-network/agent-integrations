import { afterEach, describe, expect, it, vi } from 'vitest'
import { formbricksConnector } from '../src/connectors/adapters/formbricks.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_formbricks_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'formbricks',
    label: 'Formbricks test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { appUrl: 'https://app.formbricks.com' },
    credentials: { kind: 'api-key', apiKey: 'fb_secret' },
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

describe('formbricks adapter manifest', () => {
  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = formbricksConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

})

describe('formbricks responses.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/management/responses with surveyId and data', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'resp_1', surveyId: 'svy_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await formbricksConnector.executeMutation!({
      source: source(),
      capabilityName: 'responses.create',
      args: {
        surveyId: 'svy_1',
        data: { q1: 'yes', q2: 5 },
      },
      idempotencyKey: 'k-rc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/management/responses')
    expect(requestBody).toMatchObject({
      surveyId: 'svy_1',
      data: { q1: 'yes', q2: 5 },
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when required surveyId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      formbricksConnector.executeMutation!({
        source: source(),
        capabilityName: 'responses.create',
        args: { data: { q1: 'yes' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: surveyId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      formbricksConnector.executeMutation!({
        source: source(),
        capabilityName: 'responses.create',
        args: { surveyId: 'svy_1', data: { q1: 'yes' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('formbricks surveys.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v1/management/surveys with name, type, and questions', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'svy_new', name: 'NPS' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await formbricksConnector.executeMutation!({
      source: source(),
      capabilityName: 'surveys.create',
      args: {
        name: 'NPS',
        type: 'link',
        questions: [{ id: 'q1', type: 'rating', headline: 'How likely?' }],
      },
      idempotencyKey: 'k-sc-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v1/management/surveys')
    expect(requestBody).toMatchObject({
      name: 'NPS',
      type: 'link',
      questions: [{ id: 'q1', type: 'rating', headline: 'How likely?' }],
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when required questions array is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      formbricksConnector.executeMutation!({
        source: source(),
        capabilityName: 'surveys.create',
        args: { name: 'NPS', type: 'link' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: questions/)
  })
})
