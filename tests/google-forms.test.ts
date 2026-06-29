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

  it('manifest declares OAuth2 against the Google v2 endpoints with forms scopes including write', () => {
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
      'https://www.googleapis.com/auth/forms.body',
    ])
    expect(adapter.manifest.auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(adapter.manifest.auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(adapter.manifest.auth.extraAuthParams).toMatchObject({
      access_type: 'offline',
      prompt: 'consent',
    })
  })

  it('manifest exposes 3 reads + 2 mutations with the right classes', () => {
    const caps = adapter.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))
    expect(Object.keys(byName).sort()).toEqual([
      'batch_update',
      'create_form',
      'get_form',
      'get_response',
      'list_responses',
    ])
    expect(byName.get_form.class).toBe('read')
    expect(byName.list_responses.class).toBe('read')
    expect(byName.get_response.class).toBe('read')
    expect(byName.create_form.class).toBe('mutation')
    expect(byName.batch_update.class).toBe('mutation')
    // Mutations must declare native-idempotency + externalEffect per the
    // connector contract.
    expect(byName.create_form).toMatchObject({
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/forms.body'],
    })
    expect(byName.batch_update).toMatchObject({
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/forms.body'],
    })
    // Required-param coverage: schema must enforce the minimal fields the
    // handler validates at runtime.
    expect(byName.create_form.parameters.required).toEqual(['title'])
    expect(byName.batch_update.parameters.required).toEqual(['formId', 'requests'])
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

  it('create_form POSTs to /v1/forms with info.title and returns the created form', async () => {
    let captured: { url: string; method?: string; body?: unknown } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      }
      return jsonResponse({
        formId: 'form_new',
        info: { title: 'NPS Q2', documentTitle: 'NPS Q2 doc' },
        revisionId: 'rev_0',
        responderUri: 'https://docs.google.com/forms/d/e/new/viewform',
        items: [],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_form',
      args: { title: 'NPS Q2', documentTitle: 'NPS Q2 doc' },
      idempotencyKey: 'k_create_1',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(captured!.url).toBe('https://forms.googleapis.com/v1/forms')
    expect(captured!.method).toBe('POST')
    expect(captured!.body).toEqual({
      info: { title: 'NPS Q2', documentTitle: 'NPS Q2 doc' },
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as { formId: string; info: { title: string }; revisionId: string }
      expect(data.formId).toBe('form_new')
      expect(data.info.title).toBe('NPS Q2')
      expect(data.revisionId).toBe('rev_0')
      expect(result.committedAt).toBeTypeOf('number')
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('create_form omits documentTitle when caller does not supply it', async () => {
    let body: { info: { title: string; documentTitle?: string } } | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(init!.body as string)
        return jsonResponse({ formId: 'f1', info: { title: 'X' }, revisionId: 'r' })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_form',
      args: { title: 'X' },
      idempotencyKey: 'k',
    })
    expect(body!.info.title).toBe('X')
    expect(body!.info.documentTitle).toBeUndefined()
  })

  it('create_form rejects when title is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_form',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/google-forms create_form: title is required/)
  })

  it('create_form surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_form',
        args: { title: 'X' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('create_form surfaces ProviderConfigError on a bare 403 (not a reconnect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_form',
        args: { title: 'X' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
  })

  it('batch_update POSTs to /v1/forms/{formId}:batchUpdate with the requests array', async () => {
    let captured: { url: string; method?: string; body?: unknown } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        method: init?.method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      }
      return jsonResponse({
        replies: [{ createItem: { itemId: 'item_1', questionId: ['q_1'] } }],
        form: { formId: 'form_xyz', revisionId: 'rev_2', info: { title: 'NPS' }, items: [] },
        writeControl: { requiredRevisionId: 'rev_2' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const requests = [
      {
        createItem: {
          item: { title: 'Score 0-10', questionItem: { question: { scaleQuestion: {} } } },
          location: { index: 0 },
        },
      },
    ]
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'batch_update',
      args: {
        formId: 'form_xyz',
        requests,
        includeFormInResponse: true,
        writeControl: { requiredRevisionId: 'rev_1' },
      },
      idempotencyKey: 'k_batch_1',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(captured!.url).toBe('https://forms.googleapis.com/v1/forms/form_xyz:batchUpdate')
    expect(captured!.method).toBe('POST')
    expect(captured!.body).toEqual({
      requests,
      includeFormInResponse: true,
      writeControl: { requiredRevisionId: 'rev_1' },
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as {
        formId: string
        replies: unknown[]
        form?: { revisionId: string }
        writeControl?: { requiredRevisionId: string }
      }
      expect(data.formId).toBe('form_xyz')
      expect(data.replies).toHaveLength(1)
      expect(data.form?.revisionId).toBe('rev_2')
      expect(data.writeControl?.requiredRevisionId).toBe('rev_2')
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('batch_update omits includeFormInResponse + writeControl when unset', async () => {
    let body: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(init!.body as string)
        return jsonResponse({ replies: [] })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'batch_update',
      args: { formId: 'f', requests: [{ updateFormInfo: { info: { title: 'T' }, updateMask: 'title' } }] },
      idempotencyKey: 'k',
    })
    expect(Object.keys(body!).sort()).toEqual(['requests'])
  })

  it('batch_update rejects missing formId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'batch_update',
        args: { requests: [{}] },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/google-forms batch_update: formId is required/)
  })

  it('batch_update rejects missing/empty requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'batch_update',
        args: { formId: 'f' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/requests is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'batch_update',
        args: { formId: 'f', requests: [] },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/requests is required/)
  })

  it('batch_update surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'batch_update',
        args: { formId: 'f', requests: [{}] },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('batch_update surfaces ProviderConfigError on a bare 403 (not a reconnect)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'batch_update',
        args: { formId: 'f', requests: [{}] },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
  })

  it('executeMutation throws on unknown capability', async () => {
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'no_such',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/unknown mutation capability no_such/)
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
