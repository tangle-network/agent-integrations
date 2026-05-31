import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleForms,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(
  overrides: Partial<ResolvedDataSource> = {},
  credOverrides: { expired?: boolean } = {},
): ResolvedDataSource {
  return {
    id: 'src_forms_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-forms',
    label: 'Drew Forms',
    consistencyModel: 'cache',
    scopes: [
      'https://www.googleapis.com/auth/forms.body.readonly',
      'https://www.googleapis.com/auth/forms.responses.readonly',
    ],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: credOverrides.expired ? '' : 'at_live',
      refreshToken: 'rt_live',
      expiresAt: credOverrides.expired ? Date.now() - 60_000 : Date.now() + 60 * 60 * 1000,
    },
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

describe('google-forms adapter', () => {
  const adapter = googleForms({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares OAuth2 against the Google v2 endpoints with forms readonly scopes', () => {
    expect(adapter.manifest.kind).toBe('google-forms')
    expect(adapter.manifest.displayName).toBe('Google Forms')
    expect(adapter.manifest.category).toBe('other')
    if (adapter.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    expect(adapter.manifest.auth.authorizationUrl).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(adapter.manifest.auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(adapter.manifest.auth.scopes).toEqual([
      'https://www.googleapis.com/auth/forms.body.readonly',
      'https://www.googleapis.com/auth/forms.responses.readonly',
    ])
    expect(adapter.manifest.auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(adapter.manifest.auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(adapter.manifest.auth.extraAuthParams).toMatchObject({
      access_type: 'offline',
      prompt: 'consent',
    })
  })

  it('manifest exposes get_form, list_responses, get_response — all reads', () => {
    const caps = adapter.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))
    expect(Object.keys(byName).sort()).toEqual(['get_form', 'get_response', 'list_responses'])
    expect(byName.get_form.class).toBe('read')
    expect(byName.list_responses.class).toBe('read')
    expect(byName.get_response.class).toBe('read')
  })

  it('get_form fetches the form resource and surfaces revisionId as etag', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toBe('https://forms.googleapis.com/v1/forms/form_abc')
      return jsonResponse({
        formId: 'form_abc',
        info: { title: 'NPS', description: 'Q4 NPS', documentTitle: 'NPS Q4' },
        revisionId: 'rev_1',
        responderUri: 'https://docs.google.com/forms/d/e/abc/viewform',
        items: [
          { itemId: 'q1', title: 'Score', questionItem: { question: { questionId: 'q1' } } },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_form',
      args: { formId: 'form_abc' },
      idempotencyKey: 'k1',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const data = result.data as {
      formId: string
      info: { title: string }
      items: unknown[]
      revisionId: string
      responderUri: string
    }
    expect(data.formId).toBe('form_abc')
    expect(data.info.title).toBe('NPS')
    expect(data.items).toHaveLength(1)
    expect(data.revisionId).toBe('rev_1')
    expect(data.responderUri).toContain('docs.google.com/forms')
    expect(result.etag).toBe('rev_1')
  })

  it('get_form on a missing form throws not-found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'get_form',
        args: { formId: 'missing' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrowError(/not found/i)
  })

  it('list_responses passes pageSize/pageToken/filter and flattens textAnswers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/v1/forms/form_xyz/responses?')
      expect(url).toContain('pageSize=50')
      expect(url).toContain('pageToken=tok_a')
      // URLSearchParams encodes spaces as `+` and quotes as `%22`;
      // decode + → space before asserting on the grammar.
      const decoded = decodeURIComponent(url.replace(/\+/g, ' '))
      expect(decoded).toContain('filter=timestamp > "2026-01-01T00:00:00Z"')
      return jsonResponse({
        responses: [
          {
            responseId: 'r_1',
            createTime: '2026-02-01T10:00:00Z',
            lastSubmittedTime: '2026-02-01T10:00:00Z',
            respondentEmail: 'a@b.c',
            answers: {
              q1: { questionId: 'q1', textAnswers: { answers: [{ value: '9' }] } },
              q2: {
                questionId: 'q2',
                textAnswers: { answers: [{ value: 'fast' }, { value: 'cheap' }] },
              },
            },
          },
        ],
        nextPageToken: 'tok_b',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_responses',
      args: {
        formId: 'form_xyz',
        pageSize: 50,
        pageToken: 'tok_a',
        filter: 'timestamp > "2026-01-01T00:00:00Z"',
      },
      idempotencyKey: 'k1',
    })

    const data = result.data as {
      responses: Array<{
        responseId: string
        answers: Record<string, { value: string[] }>
        raw: unknown
      }>
      nextPageToken: string
    }
    expect(data.responses).toHaveLength(1)
    expect(data.responses[0].responseId).toBe('r_1')
    expect(data.responses[0].answers.q1.value).toEqual(['9'])
    expect(data.responses[0].answers.q2.value).toEqual(['fast', 'cheap'])
    expect(data.responses[0].raw).toBeDefined()
    expect(data.nextPageToken).toBe('tok_b')
  })

  it('list_responses with no optional args sends a bare responses URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toBe('https://forms.googleapis.com/v1/forms/form_q/responses')
      return jsonResponse({ responses: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_responses',
      args: { formId: 'form_q' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { responses: unknown[]; nextPageToken?: string }
    expect(data.responses).toEqual([])
    expect(data.nextPageToken).toBeUndefined()
  })

  it('get_response fetches a single response by id and flattens it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toBe('https://forms.googleapis.com/v1/forms/form_xyz/responses/r_42')
      return jsonResponse({
        responseId: 'r_42',
        createTime: '2026-03-01T00:00:00Z',
        answers: {
          q1: { questionId: 'q1', textAnswers: { answers: [{ value: 'yes' }] } },
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_response',
      args: { formId: 'form_xyz', responseId: 'r_42' },
      idempotencyKey: 'k1',
    })
    const data = result.data as {
      responseId: string
      answers: Record<string, { value: string[] }>
    }
    expect(data.responseId).toBe('r_42')
    expect(data.answers.q1.value).toEqual(['yes'])
  })

  it('a 401 from Forms surfaces as CredentialsExpired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'get_form',
        args: { formId: 'form_abc' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrowError(/rejected token/i)
  })

  it('test() returns ok:false on a 401 from Google userinfo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const r = await adapter.test(source())
    expect(r.ok).toBe(false)
  })

  it('test() returns ok:true when userinfo succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ sub: 'u_1', email: 'a@b.c' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const r = await adapter.test(source())
    expect(r.ok).toBe(true)
  })
})
