import { afterEach, describe, expect, it, vi } from 'vitest'
import { filloutFormsConnector } from '../src/connectors/adapters/fillout-forms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_fillout_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'fillout-forms',
    label: 'Fillout test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'fillout_secret' },
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

describe('fillout-forms adapter manifest', () => {
  it('classifies itself as the webhook category and exposes the fillout-forms kind', () => {
    expect(filloutFormsConnector.manifest.kind).toBe('fillout-forms')
    expect(filloutFormsConnector.manifest.category).toBe('webhook')
    expect(filloutFormsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = filloutFormsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers form discovery, submissions read/write, and webhook plumbing', () => {
    const names = filloutFormsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'find.form.by.title',
        'form.metadata',
        'forms.list',
        'get.form.responses',
        'get.single.response',
        'submission.create',
        'submission.delete',
        'webhooks.create',
        'webhooks.delete',
      ].sort(),
    )
    const reads = filloutFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = filloutFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['find.form.by.title', 'form.metadata', 'forms.list', 'get.form.responses', 'get.single.response'].sort(),
    )
    expect(mutations).toEqual(
      ['submission.create', 'submission.delete', 'webhooks.create', 'webhooks.delete'].sort(),
    )
  })

  it('marks the new submission.* mutations as native-idempotency external effects', () => {
    const targets = new Set(['submission.create', 'submission.delete'])
    for (const cap of filloutFormsConnector.manifest.capabilities) {
      if (!targets.has(cap.name)) continue
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') throw new Error('unreachable')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('fillout-forms submission.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/api/forms/{formId}/submissions with the submissions envelope', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sub_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await filloutFormsConnector.executeMutation!({
      source: source(),
      capabilityName: 'submission.create',
      args: {
        formId: 'form_abc',
        submissions: [{ questions: [{ id: 'q1', value: 'hello' }] }],
      },
      idempotencyKey: 'k-create',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.fillout.com/v1/api/forms/form_abc/submissions')
    expect(requestBody).toEqual({
      submissions: [{ questions: [{ id: 'q1', value: 'hello' }] }],
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      filloutFormsConnector.executeMutation!({
        source: source(),
        capabilityName: 'submission.create',
        args: { formId: 'form_abc', submissions: [] },
        idempotencyKey: 'k-401',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('fillout-forms submission.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs the submission resource by id', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await filloutFormsConnector.executeMutation!({
      source: source(),
      capabilityName: 'submission.delete',
      args: { formId: 'form_abc', submissionId: 'sub_1' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe(
      'https://api.fillout.com/v1/api/forms/form_abc/submissions/sub_1',
    )
  })
})
