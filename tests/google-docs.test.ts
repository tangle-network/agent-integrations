import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleDocs,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(
  overrides: Partial<ResolvedDataSource> = {},
  credOverrides: { expired?: boolean } = {},
): ResolvedDataSource {
  return {
    id: 'src_docs_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-docs',
    label: 'Drew Docs',
    consistencyModel: 'authoritative',
    scopes: [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.file',
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

describe('google-docs adapter', () => {
  const adapter = googleDocs({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares OAuth2 against the Google v2 endpoints with documents + drive.file scopes', () => {
    expect(adapter.manifest.kind).toBe('google-docs')
    expect(adapter.manifest.displayName).toBe('Google Docs')
    expect(adapter.manifest.category).toBe('doc')
    if (adapter.manifest.auth.kind !== 'oauth2') {
      throw new Error('expected oauth2 auth')
    }
    expect(adapter.manifest.auth.authorizationUrl).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(adapter.manifest.auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(adapter.manifest.auth.scopes).toEqual([
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive.file',
    ])
    expect(adapter.manifest.auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(adapter.manifest.auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(adapter.manifest.auth.extraAuthParams).toMatchObject({
      access_type: 'offline',
      prompt: 'consent',
    })
  })

  it('manifest exposes get_document, create_document, append_text, delete_document, export_document with the right classes + CAS', () => {
    const caps = adapter.manifest.capabilities
    const byName = Object.fromEntries(caps.map((c) => [c.name, c]))
    expect(Object.keys(byName).sort()).toEqual([
      'append_text',
      'create_document',
      'delete_document',
      'export_document',
      'get_document',
    ])

    expect(byName.get_document.class).toBe('read')
    expect(byName.export_document.class).toBe('read')

    const createCap = byName.create_document
    expect(createCap.class).toBe('mutation')
    if (createCap.class === 'mutation') {
      expect(createCap.cas).toBe('native-idempotency')
      expect(createCap.externalEffect).toBe(true)
    }

    const appendCap = byName.append_text
    expect(appendCap.class).toBe('mutation')
    if (appendCap.class === 'mutation') {
      expect(appendCap.cas).toBe('etag-if-match')
      expect(appendCap.externalEffect).toBe(true)
    }

    const deleteCap = byName.delete_document
    expect(deleteCap.class).toBe('mutation')
    if (deleteCap.class === 'mutation') {
      expect(deleteCap.cas).toBe('native-idempotency')
      expect(deleteCap.externalEffect).toBe(true)
    }
  })

  it('delete_document PATCHes the Drive file with trashed=true and commits', async () => {
    let observedUrl: string | undefined
    let observedMethod: string | undefined
    let observedBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method
      observedBody = init?.body ? String(init.body) : undefined
      return jsonResponse({ id: 'doc_trash', trashed: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_document',
      args: { documentId: 'doc_trash' },
      idempotencyKey: 'k1',
    })
    expect(observedUrl).toBe('https://www.googleapis.com/drive/v3/files/doc_trash')
    expect(observedMethod).toBe('PATCH')
    expect(JSON.parse(observedBody ?? '{}')).toEqual({ trashed: true })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { trashed: boolean }).trashed).toBe(true)
    }
  })

  it('delete_document surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_document',
        args: { documentId: 'doc_q' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('export_document maps friendly formats to Drive export mime types', async () => {
    let observedUrl: string | undefined
    const payload = new TextEncoder().encode('%PDF-1.4 fake pdf bytes')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return new Response(payload, { status: 200, headers: { 'content-type': 'application/pdf' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'export_document',
      args: { documentId: 'doc_e', format: 'pdf' },
      idempotencyKey: 'k1',
    })
    expect(observedUrl).toBe(
      'https://www.googleapis.com/drive/v3/files/doc_e/export?mimeType=application%2Fpdf',
    )
    const data = result.data as { mimeType: string; byteLength: number; contentBase64: string }
    expect(data.mimeType).toBe('application/pdf')
    expect(data.byteLength).toBe(payload.length)
    expect(typeof data.contentBase64).toBe('string')
    expect(data.contentBase64.length).toBeGreaterThan(0)
  })

  it('export_document rejects when neither format nor mimeType is supplied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'export_document',
        args: { documentId: 'doc_e' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrowError(/format must be one of|mimeType/i)
  })

  it('get_document collapses paragraph textRuns into a single plaintext string', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toBe('https://docs.googleapis.com/v1/documents/doc_abc')
      return jsonResponse({
        documentId: 'doc_abc',
        title: 'Q4 Plan',
        revisionId: 'rev_1',
        body: {
          content: [
            {
              endIndex: 14,
              paragraph: {
                elements: [
                  { textRun: { content: 'Hello ' } },
                  { textRun: { content: 'world\n' } },
                ],
              },
            },
            {
              endIndex: 20,
              paragraph: {
                elements: [{ textRun: { content: 'bye\n' } }],
              },
            },
          ],
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_document',
      args: { documentId: 'doc_abc' },
      idempotencyKey: 'k1',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const data = result.data as { documentId: string; title: string; revisionId: string; body: { content: string } }
    expect(data.documentId).toBe('doc_abc')
    expect(data.title).toBe('Q4 Plan')
    expect(data.body.content).toBe('Hello world\nbye\n')
    expect(result.etag).toBe('rev_1')
  })

  it('create_document creates the doc then inserts the body via batchUpdate', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === 'https://docs.googleapis.com/v1/documents' && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as { title: string }
        expect(sent.title).toBe('Strategy')
        return jsonResponse({ documentId: 'doc_new', title: 'Strategy', revisionId: 'rev_a' })
      }
      if (url.endsWith(':batchUpdate')) {
        const sent = JSON.parse(String(init?.body)) as { requests: Array<{ insertText?: { location: { index: number }; text: string } }> }
        expect(sent.requests[0].insertText?.text).toBe('first line')
        expect(sent.requests[0].insertText?.location.index).toBe(1)
        return jsonResponse({ writeControl: { requiredRevisionId: 'rev_b' } })
      }
      throw new Error('unexpected url: ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_document',
      args: { title: 'Strategy', body: 'first line' },
      idempotencyKey: 'k1',
    })
    expect(calls).toHaveLength(2)
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { documentId: string; revisionId: string }).documentId).toBe('doc_new')
      expect(result.etagAfter).toBe('rev_b')
    }
  })

  it('append_text surfaces a stale requiredRevisionId as ResourceContention', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://docs.googleapis.com/v1/documents/doc_x?fields=')) {
        return jsonResponse({
          documentId: 'doc_x',
          revisionId: 'rev_old',
          body: { content: [{ endIndex: 10 }] },
        })
      }
      if (url.endsWith(':batchUpdate') && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as { writeControl?: { requiredRevisionId?: string } }
        expect(sent.writeControl?.requiredRevisionId).toBe('rev_stale')
        return new Response(
          JSON.stringify({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'requiredRevisionId mismatch' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error('unexpected url: ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'append_text',
        args: { documentId: 'doc_x', text: 'more', requiredRevisionId: 'rev_stale' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrowError(/concurrent edit/i)
  })

  it('append_text without requiredRevisionId commits successfully', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('?fields=')) {
        return jsonResponse({
          documentId: 'doc_y',
          revisionId: 'rev_curr',
          body: { content: [{ endIndex: 25 }] },
        })
      }
      if (url.endsWith(':batchUpdate') && init?.method === 'POST') {
        const sent = JSON.parse(String(init.body)) as {
          requests: Array<{ insertText?: { location: { index: number }; text: string } }>
          writeControl?: unknown
        }
        // findAppendIndex returns endIndex - 1 = 24.
        expect(sent.requests[0].insertText?.location.index).toBe(24)
        expect(sent.requests[0].insertText?.text).toBe('extra')
        expect(sent.writeControl).toBeUndefined()
        return jsonResponse({ writeControl: { requiredRevisionId: 'rev_next' } })
      }
      throw new Error('unexpected url: ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'append_text',
      args: { documentId: 'doc_y', text: 'extra' },
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.etagAfter).toBe('rev_next')
    }
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
