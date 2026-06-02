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
    expect(names).toEqual([
      'files.delete',
      'files.move',
      'files.share',
      'files.upload',
      'folders.create',
      'list_files',
      'read_file',
      'watch_folder',
    ])
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

  it('exposes the write-side capabilities as native-idempotency externalEffect mutations', () => {
    const writeNames = ['files.upload', 'files.delete', 'files.move', 'files.share', 'folders.create']
    for (const name of writeNames) {
      const cap = adapter.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      expect(cap!.class).toBe('mutation')
      if (cap!.class === 'mutation') {
        expect(cap!.cas).toBe('native-idempotency')
        expect(cap!.externalEffect).toBe(true)
      }
      expect(cap!.requiredScopes).toContain('https://graph.microsoft.com/Files.ReadWrite')
    }
  })

  it('files.upload PUTs the small-file content endpoint with the requested content-type', async () => {
    let capturedUrl: string | undefined
    let capturedHeaders: Record<string, string> | undefined
    let capturedBody: BodyInit | null | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>
      capturedBody = init?.body as BodyInit | null | undefined
      expect(init?.method).toBe('PUT')
      return jsonResponse({ id: 'fid_1', name: 'hello.txt', eTag: 'W/"v1"', size: 5, file: { mimeType: 'text/plain' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: { folderId: 'fld_42', fileName: 'hello.txt', fileContent: 'hello', contentType: 'text/plain' },
      idempotencyKey: 'k1',
    })
    expect(capturedUrl).toContain('/me/drive/items/fld_42:/hello.txt:/content')
    expect(capturedHeaders!['content-type']).toBe('text/plain')
    expect(Buffer.isBuffer(capturedBody)).toBe(true)
    expect((capturedBody as Buffer).toString('utf-8')).toBe('hello')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('fid_1')
      expect(result.etagAfter).toBe('W/"v1"')
    }
  })

  it('files.upload decodes base64 fileContent before uploading', async () => {
    let capturedBody: BodyInit | null | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as BodyInit | null | undefined
        return jsonResponse({ id: 'fid_2', name: 'photo.jpg', eTag: 'W/"v2"' })
      }),
    )
    const base64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64')
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: { folderId: 'root', fileName: 'photo.jpg', fileContent: base64, encoding: 'base64', contentType: 'image/jpeg' },
      idempotencyKey: 'k2',
    })
    expect(Buffer.isBuffer(capturedBody)).toBe(true)
    expect((capturedBody as Buffer).toString('hex')).toBe('ffd8ffe0')
  })

  it('files.upload routes folderId="root" to /me/drive/root:/...:/content', async () => {
    let capturedUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse({ id: 'fid_3', name: 'r.txt', eTag: 'W/"v3"' })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: { folderId: 'root', fileName: 'r.txt', fileContent: 'hi' },
      idempotencyKey: 'k3',
    })
    expect(capturedUrl).toContain('/me/drive/root:/r.txt:/content')
  })

  it('files.upload surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'files.upload',
        args: { folderId: 'fld', fileName: 'x.txt', fileContent: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('files.delete issues DELETE on /items/{id} and returns committed', async () => {
    let capturedMethod: string | undefined
    let capturedUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = init?.method
        capturedUrl = String(input)
        return new Response(null, { status: 204 })
      }),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.delete',
      args: { itemId: 'fid_x' },
      idempotencyKey: 'k-del',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toContain('/me/drive/items/fid_x')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { deleted: boolean }).deleted).toBe(true)
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('files.delete treats 404 as idempotent replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.delete',
      args: { itemId: 'fid_gone' },
      idempotencyKey: 'k-del2',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
      expect((result.data as { alreadyDeleted: boolean }).alreadyDeleted).toBe(true)
    }
  })

  it('files.move PATCHes /items/{id} with parentReference and name', async () => {
    let capturedMethod: string | undefined
    let capturedUrl: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = init?.method
        capturedUrl = String(input)
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ id: 'fid_x', name: 'renamed.txt', eTag: 'W/"v9"', parentReference: { id: 'fld_new' } })
      }),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.move',
      args: { itemId: 'fid_x', newParentId: 'fld_new', newName: 'renamed.txt' },
      idempotencyKey: 'k-mv',
    })
    expect(capturedMethod).toBe('PATCH')
    expect(capturedUrl).toContain('/me/drive/items/fid_x')
    expect(capturedBody.parentReference).toEqual({ id: 'fld_new' })
    expect(capturedBody.name).toBe('renamed.txt')
    expect(result.status).toBe('committed')
  })

  it('files.move maps newParentId="root" to the drive-root path', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ id: 'fid_x', name: 'a.txt' })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.move',
      args: { itemId: 'fid_x', newParentId: 'root' },
      idempotencyKey: 'k-mv2',
    })
    expect((capturedBody.parentReference as { path: string }).path).toBe('/drive/root')
  })

  it('files.move requires at least one of newParentId or newName', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'files.move',
        args: { itemId: 'fid_x' },
        idempotencyKey: 'k-mv3',
      }),
    ).rejects.toThrow(/at least one of newParentId or newName/)
  })

  it('files.share POSTs createLink and returns the permission payload', async () => {
    let capturedUrl: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({
          id: 'perm_1',
          roles: ['read'],
          link: { webUrl: 'https://1drv.ms/abc', type: 'view', scope: 'anonymous' },
        })
      }),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.share',
      args: { itemId: 'fid_share', type: 'edit', scope: 'organization' },
      idempotencyKey: 'k-share',
    })
    expect(capturedUrl).toContain('/me/drive/items/fid_share/createLink')
    expect(capturedBody.type).toBe('edit')
    expect(capturedBody.scope).toBe('organization')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { permissionId: string }).permissionId).toBe('perm_1')
    }
  })

  it('files.share defaults to view/anonymous when type/scope are omitted', async () => {
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse({ id: 'perm_2', link: { webUrl: 'https://1drv.ms/x' } })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'files.share',
      args: { itemId: 'fid_d' },
      idempotencyKey: 'k-share-d',
    })
    expect(capturedBody.type).toBe('view')
    expect(capturedBody.scope).toBe('anonymous')
  })

  it('folders.create POSTs /items/{parent}/children with folder + conflict behavior', async () => {
    let capturedUrl: string | undefined
    let capturedBody: Record<string, unknown> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonResponse(
          { id: 'fld_new', name: 'Reports', eTag: 'W/"f1"' },
          { status: 201 },
        )
      }),
    )
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'folders.create',
      args: { parentId: 'fld_root_x', name: 'Reports' },
      idempotencyKey: 'k-mkdir',
    })
    expect(capturedUrl).toContain('/me/drive/items/fld_root_x/children')
    expect(capturedBody.name).toBe('Reports')
    expect((capturedBody.folder as Record<string, unknown>)).toEqual({})
    expect(capturedBody['@microsoft.graph.conflictBehavior']).toBe('fail')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('fld_new')
    }
  })

  it('folders.create routes parentId="root" to /me/drive/root/children', async () => {
    let capturedUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse({ id: 'fld_r', name: 'Inbox' }, { status: 201 })
      }),
    )
    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'folders.create',
      args: { parentId: 'root', name: 'Inbox' },
      idempotencyKey: 'k-mkdir-root',
    })
    expect(capturedUrl).toContain('/me/drive/root/children')
  })
})
