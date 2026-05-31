import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  oneDrive,
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(
  overrides: Partial<ResolvedDataSource> = {},
  credOverrides: { expired?: boolean } = {},
): ResolvedDataSource {
  return {
    id: 'src_onedrive_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'onedrive',
    label: 'Drew OneDrive',
    consistencyModel: 'authoritative',
    scopes: ['https://graph.microsoft.com/Files.Read', 'offline_access'],
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

describe('onedrive adapter', () => {
  const adapter = oneDrive({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ships a valid manifest', () => {
    const result = validateConnectorManifest(adapter.manifest)
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('manifest exposes list_files, read_file, watch_folder', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['list_files', 'read_file', 'watch_folder'])
  })

  it('declares the Microsoft v2.0 OAuth URLs and env vars', () => {
    const auth = adapter.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2')
    expect(auth.authorizationUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(auth.clientIdEnv).toBe('MS_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('MS_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('https://graph.microsoft.com/Files.Read')
    expect(auth.scopes).toContain('offline_access')
  })

  it('gates watch_folder behind the Files.ReadWrite scope', () => {
    const watch = adapter.manifest.capabilities.find((c) => c.name === 'watch_folder')!
    expect(watch.class).toBe('mutation')
    expect(watch.requiredScopes).toContain('https://graph.microsoft.com/Files.ReadWrite')
  })

  it('opts the write scope into the OAuth grant when includeWriteScope=true', () => {
    const withWrite = oneDrive({ clientId: 'cid', clientSecret: 'sec', includeWriteScope: true })
    const auth = withWrite.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2')
    expect(auth.scopes).toContain('https://graph.microsoft.com/Files.ReadWrite')
  })

  it('list_files targets /me/drive/items/{id}/children with $orderby when no query', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/me/drive/items/fld_123/children')
      const sp = new URL(url).searchParams
      expect(sp.get('$orderby')).toBe('lastModifiedDateTime desc')
      expect(sp.get('$search')).toBeNull()
      return jsonResponse({ value: [{ id: 'f1', name: 'NDA.pdf', file: { mimeType: 'application/pdf' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_files',
      args: { folderId: 'fld_123' },
      idempotencyKey: 'k1',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect((result.data as { files: unknown[] }).files).toHaveLength(1)
  })

  it('list_files routes search queries through /me/drive/root/search with ConsistencyLevel=eventual', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      expect(url).toContain("/me/drive/root/search(q=")
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers['ConsistencyLevel']).toBe('eventual')
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_files',
      args: { query: 'NDA' },
      idempotencyKey: 'k1',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('read_file returns base64 for binary mime types', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('?$select=')) {
        return jsonResponse({ id: 'f1', name: 'photo.jpg', eTag: 'W/"1"', file: { mimeType: 'image/jpeg' } })
      }
      if (url.endsWith('/content')) {
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
      }
      throw new Error('unexpected url ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'read_file',
      args: { fileId: 'f1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { content: string; encoding: string; mimeType: string }
    expect(data.encoding).toBe('base64')
    expect(data.mimeType).toBe('image/jpeg')
    expect(Buffer.from(data.content, 'base64').toString('hex')).toBe('ffd8ffe0')
    expect(result.etag).toBe('W/"1"')
  })

  it('read_file returns utf-8 text for text-like mime types', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('?$select=')) {
        return jsonResponse({ id: 'f1', name: 'notes.txt', file: { mimeType: 'text/plain' } })
      }
      return new Response('hello onedrive', { status: 200, headers: { 'content-type': 'text/plain' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'read_file',
      args: { fileId: 'f1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { content: string; encoding: string }
    expect(data.encoding).toBe('utf-8')
    expect(data.content).toBe('hello onedrive')
  })

  it('read_file refuses to download a folder', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'fld_1', name: 'Docs', folder: { childCount: 3 } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeRead!({
        source: source(),
        capabilityName: 'read_file',
        args: { fileId: 'fld_1' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow(/is a folder/)
  })

  it('watch_folder POSTs a /subscriptions request with the folder resource', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions')
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      expect(body.resource).toBe('/me/drive/items/fld_42')
      expect(body.notificationUrl).toBe('https://hook.example/onedrive')
      expect(body.clientState).toBe('idem-1')
      return jsonResponse(
        {
          id: 'sub_xyz',
          expirationDateTime: '2026-06-01T00:00:00Z',
          resource: '/me/drive/items/fld_42',
        },
        { status: 201 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source({ scopes: ['https://graph.microsoft.com/Files.ReadWrite'] }),
      capabilityName: 'watch_folder',
      args: { folderId: 'fld_42', notificationUrl: 'https://hook.example/onedrive' },
      idempotencyKey: 'idem-1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { subscriptionId: string }).subscriptionId).toBe('sub_xyz')
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('watch_folder maps folderId="root" to the drive-root resource path', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      expect(body.resource).toBe('/me/drive/root')
      return jsonResponse({ id: 'sub_root', expirationDateTime: '2026-06-01T00:00:00Z' }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'watch_folder',
      args: { folderId: 'root', notificationUrl: 'https://hook.example/onedrive' },
      idempotencyKey: 'idem-root',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('test() returns ok:false on a 401 from Graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const r = await adapter.test(source())
    expect(r.ok).toBe(false)
  })

  it('test() returns ok:true on a 200 from /me/drive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'drv_1' })))
    const r = await adapter.test(source())
    expect(r.ok).toBe(true)
  })

  it('exchangeOAuth throws when the client is unconfigured', async () => {
    const broken = oneDrive({ clientId: '', clientSecret: '' })
    await expect(
      broken.exchangeOAuth!({ code: 'c', state: 's', codeVerifier: 'v', redirectUri: 'https://x/cb' }),
    ).rejects.toThrow(/MS_OAUTH_CLIENT_ID/)
  })
})
