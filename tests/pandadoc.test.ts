import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pandadoc,
  type ResolvedDataSource,
} from '../src/connectors/index'

const oauthSource = (): ResolvedDataSource => ({
  id: 'src_pandadoc_1',
  projectId: 'proj_1',
  publishedAgentId: null,
  kind: 'pandadoc',
  label: 'PandaDoc',
  consistencyModel: 'authoritative',
  scopes: ['read', 'read+write'],
  metadata: {},
  credentials: {
    kind: 'oauth2',
    accessToken: 'pdoc_at_live_123',
    refreshToken: 'pdoc_rt_456',
    expiresAt: Date.now() + 60 * 60 * 1000,
  },
  status: 'active',
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('pandadoc adapter', () => {
  const adapter = pandadoc({ clientId: 'cid', clientSecret: 'csec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares oauth2 auth with correct authorize/token URLs + env vars', () => {
    expect(adapter.manifest.auth.kind).toBe('oauth2')
    if (adapter.manifest.auth.kind !== 'oauth2') throw new Error('expected oauth2')
    expect(adapter.manifest.auth.authorizationUrl).toBe('https://app.pandadoc.com/oauth2/authorize')
    expect(adapter.manifest.auth.tokenUrl).toBe('https://api.pandadoc.com/oauth2/access_token')
    expect(adapter.manifest.auth.clientIdEnv).toBe('PANDADOC_OAUTH_CLIENT_ID')
    expect(adapter.manifest.auth.clientSecretEnv).toBe('PANDADOC_OAUTH_CLIENT_SECRET')
    expect(adapter.manifest.auth.scopes).toEqual(['read', 'read+write'])
  })

  it('manifest exposes the five PandaDoc capabilities expected by the docs action pack', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'cancel_document',
      'create_document',
      'get_document',
      'search_documents',
      'send_document',
    ])
    // Reads vs mutations
    const byClass = Object.fromEntries(adapter.manifest.capabilities.map((c) => [c.name, c.class]))
    expect(byClass.search_documents).toBe('read')
    expect(byClass.get_document).toBe('read')
    expect(byClass.create_document).toBe('mutation')
    expect(byClass.send_document).toBe('mutation')
    expect(byClass.cancel_document).toBe('mutation')
  })

  it('search_documents hits GET /documents with q + status + count', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedHeaders = init?.headers as Record<string, string>
      return jsonResponse({
        results: [
          { id: 'doc_1', name: 'MSA Acme', status: 'document.sent', date_created: '2026-05-01T00:00:00Z' },
        ],
      })
    }))
    const result = await adapter.executeRead!({
      source: oauthSource(),
      capabilityName: 'search_documents',
      args: { query: 'Acme', status: 'document.sent', limit: 10 },
      idempotencyKey: 'k1',
    })
    expect(capturedUrl).toContain('https://api.pandadoc.com/public/v1/documents?')
    expect(capturedUrl).toContain('q=Acme')
    expect(capturedUrl).toContain('status=document.sent')
    expect(capturedUrl).toContain('count=10')
    expect(capturedHeaders.authorization).toBe('Bearer pdoc_at_live_123')
    const data = result.data as { documents: Array<{ documentId: string; status: string }> }
    expect(data.documents).toHaveLength(1)
    expect(data.documents[0].documentId).toBe('doc_1')
    expect(data.documents[0].status).toBe('document.sent')
  })

  it('get_document hits /documents/:id/details and normalizes recipients', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      id: 'doc_1',
      name: 'MSA Acme',
      status: 'document.completed',
      date_created: '2026-05-01T00:00:00Z',
      date_modified: '2026-05-02T00:00:00Z',
      recipients: [
        { email: 's@acme.com', first_name: 'Sam', last_name: 'Signer', role: 'Customer', has_completed: true },
      ],
      tokens: [{ name: 'Client.Name', value: 'Acme' }],
    })))
    const result = await adapter.executeRead!({
      source: oauthSource(),
      capabilityName: 'get_document',
      args: { documentId: 'doc_1' },
      idempotencyKey: 'k2',
    })
    const data = result.data as {
      documentId: string
      status: string
      recipients: Array<{ email: string; hasCompleted: boolean }>
    }
    expect(data.documentId).toBe('doc_1')
    expect(data.status).toBe('document.completed')
    expect(data.recipients[0].hasCompleted).toBe(true)
    expect(result.etag).toBe('2026-05-02T00:00:00Z')
  })

  it('create_document writes idempotency fingerprint into metadata and is idempotent on replay', async () => {
    // 1) Fingerprint lookup returns existing match → replay.
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain('metadata_tangleIdempotencyKey=idemp-9')
      return jsonResponse({
        results: [
          { id: 'doc_replay', name: 'MSA Acme', status: 'document.draft', date_modified: '2026-05-02T00:00:00Z' },
        ],
      })
    }))
    const replay = await adapter.executeMutation!({
      source: oauthSource(),
      capabilityName: 'create_document',
      args: {
        name: 'MSA Acme',
        templateId: 'tpl_abc',
        recipients: [{ email: 'sam@acme.com' }],
      },
      idempotencyKey: 'idemp-9',
    })
    expect(replay.status).toBe('committed')
    if (replay.status === 'committed') {
      expect(replay.idempotentReplay).toBe(true)
      expect((replay.data as { documentId: string }).documentId).toBe('doc_replay')
    }
  })

  it('create_document POSTs to /documents when no fingerprint match exists', async () => {
    let postBody: Record<string, unknown> | null = null
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      const u = String(url)
      // First call = fingerprint lookup → empty.
      if (u.includes('metadata_tangleIdempotencyKey')) {
        return jsonResponse({ results: [] })
      }
      // Second call = POST /documents.
      expect(init?.method).toBe('POST')
      postBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'doc_new',
        name: 'MSA Acme',
        status: 'document.uploaded',
        date_modified: '2026-05-02T00:00:00Z',
      })
    }))
    const result = await adapter.executeMutation!({
      source: oauthSource(),
      capabilityName: 'create_document',
      args: {
        name: 'MSA Acme',
        templateId: 'tpl_abc',
        recipients: [{ email: 'sam@acme.com', firstName: 'Sam', lastName: 'A.', role: 'Customer' }],
      },
      idempotencyKey: 'idemp-10',
    })
    expect(calls).toBe(2)
    expect(postBody).not.toBeNull()
    const body = postBody as unknown as { template_uuid: string; metadata: Record<string, unknown>; recipients: Array<{ email: string; first_name?: string }> }
    expect(body.template_uuid).toBe('tpl_abc')
    expect(body.metadata.tangleIdempotencyKey).toBe('idemp-10')
    expect(body.recipients[0].first_name).toBe('Sam')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
      expect((result.data as { documentId: string }).documentId).toBe('doc_new')
    }
  })

  it('send_document maps already-sent 400 to ResourceContention', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"document already sent"}', { status: 400, headers: { 'content-type': 'application/json' } })))
    await expect(
      adapter.executeMutation!({
        source: oauthSource(),
        capabilityName: 'send_document',
        args: { documentId: 'doc_1' },
        idempotencyKey: 'k3',
      }),
    ).rejects.toThrow(/not in a sendable state/)
  })

  it('send_document surfaces 429 as rate-limited with retryAfterMs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '4' } })))
    const result = await adapter.executeMutation!({
      source: oauthSource(),
      capabilityName: 'send_document',
      args: { documentId: 'doc_1' },
      idempotencyKey: 'k4',
    })
    expect(result.status).toBe('rate-limited')
    if (result.status === 'rate-limited') {
      expect(result.retryAfterMs).toBe(4_000)
    }
  })

  it('cancel_document treats already-voided as idempotent replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"document is already voided"}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })))
    const result = await adapter.executeMutation!({
      source: oauthSource(),
      capabilityName: 'cancel_document',
      args: { documentId: 'doc_1', reason: 'duplicate' },
      idempotencyKey: 'k5',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
      expect((result.data as { status: string }).status).toBe('document.voided')
    }
  })

  it('executeRead throws CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    await expect(
      adapter.executeRead!({
        source: oauthSource(),
        capabilityName: 'get_document',
        args: { documentId: 'doc_x' },
        idempotencyKey: 'k6',
      }),
    ).rejects.toThrow(/PandaDoc rejected token/)
  })

  it('exchangeOAuth posts to PandaDoc token endpoint and returns oauth2 envelope', async () => {
    let capturedUrl = ''
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedBody = String(init?.body)
      return jsonResponse({ access_token: 'at_new', refresh_token: 'rt_new', expires_in: 3600, scope: 'read read+write' })
    }))
    const result = await adapter.exchangeOAuth!({
      code: 'abc',
      state: 'st',
      codeVerifier: 'cv',
      redirectUri: 'https://hub/cb',
    })
    expect(capturedUrl).toBe('https://api.pandadoc.com/oauth2/access_token')
    expect(capturedBody).toContain('grant_type=authorization_code')
    expect(capturedBody).toContain('code=abc')
    expect(result.credentials.kind).toBe('oauth2')
    if (result.credentials.kind === 'oauth2') {
      expect(result.credentials.accessToken).toBe('at_new')
      expect(result.credentials.refreshToken).toBe('rt_new')
    }
    expect(result.scopes).toEqual(['read', 'read+write'])
  })

  it('test() returns ok=true on 200 from /documents probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const probe = await adapter.test(oauthSource())
    expect(probe.ok).toBe(true)
  })

  it('test() returns ok=false on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const probe = await adapter.test(oauthSource())
    expect(probe.ok).toBe(false)
    if (!probe.ok) expect(probe.reason).toMatch(/401/)
  })
})
