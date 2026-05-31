import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sharepoint,
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_sp_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'sharepoint',
    label: 'Acme SharePoint',
    consistencyModel: 'authoritative',
    scopes: [
      'https://graph.microsoft.com/Sites.Read.All',
      'https://graph.microsoft.com/Files.ReadWrite.All',
    ],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
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

describe('sharepoint adapter', () => {
  const adapter = sharepoint({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest passes the connector validator', () => {
    expect(validateConnectorManifest(adapter.manifest)).toEqual({ ok: true, issues: [] })
  })

  it('manifest exposes the expected storage-pack capability set', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'create_folder',
      'get_item_content',
      'list_drive_items',
      'search_drive',
      'search_sites',
      'upload_file',
    ])
  })

  it('declares oauth2 auth with v2.0 endpoints and the documented env-var names', () => {
    expect(adapter.manifest.auth).toMatchObject({
      kind: 'oauth2',
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      clientIdEnv: 'MS_OAUTH_CLIENT_ID',
      clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
    })
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.scopes).toContain('offline_access')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/Sites.Read.All')
      expect(adapter.manifest.auth.scopes).toContain(
        'https://graph.microsoft.com/Files.ReadWrite.All',
      )
    }
  })

  it('storage-class manifest is authoritative; both mutations are native-idempotency under the consistency floor', () => {
    expect(adapter.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(adapter.manifest.category).toBe('storage')
    const upload = adapter.manifest.capabilities.find((c) => c.name === 'upload_file')!
    const folder = adapter.manifest.capabilities.find((c) => c.name === 'create_folder')!
    expect(upload.class).toBe('mutation')
    expect(folder.class).toBe('mutation')
    if (upload.class === 'mutation') {
      expect(upload.cas).toBe('native-idempotency')
      expect(upload.externalEffect).toBe(true)
    }
    if (folder.class === 'mutation') {
      // Graph enforces sibling-name uniqueness — that's native-idempotency,
      // not advisory; the validator rejects cas:'none' under an authoritative
      // consistency floor.
      expect(folder.cas).toBe('native-idempotency')
      expect(folder.externalEffect).toBe(true)
    }
  })

  it('exposes read + mutation handlers consistent with the manifest', () => {
    const hasReads = adapter.manifest.capabilities.some((c) => c.class === 'read')
    const hasMutations = adapter.manifest.capabilities.some((c) => c.class === 'mutation')
    expect(Boolean(adapter.executeRead)).toBe(hasReads)
    expect(Boolean(adapter.executeMutation)).toBe(hasMutations)
  })

  it('search_sites builds the Graph search URL and maps results into a sites[] summary', async () => {
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return jsonResponse({
        value: [
          {
            id: 'acme.sharepoint.com,11,22',
            displayName: 'Acme HQ',
            webUrl: 'https://acme.sharepoint.com/sites/HQ',
            description: 'tenant root',
          },
          { id: 'acme.sharepoint.com,33,44', name: 'Eng', webUrl: 'https://acme.sharepoint.com/sites/eng' },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'search_sites',
      args: { query: 'acme & co' },
      idempotencyKey: 'k1',
    })

    expect(observedUrl).toContain('https://graph.microsoft.com/v1.0/sites?search=')
    expect(decodeURIComponent(observedUrl)).toContain('search=acme & co')
    expect(observedUrl).toContain('$top=20')
    const data = result.data as { sites: Array<{ id: string; name?: string; webUrl?: string }> }
    expect(data.sites).toHaveLength(2)
    expect(data.sites[0]).toMatchObject({ id: 'acme.sharepoint.com,11,22', name: 'Acme HQ' })
    expect(data.sites[1]).toMatchObject({ id: 'acme.sharepoint.com,33,44', name: 'Eng' })
  })

  it('list_drive_items hits root/children when folderId is omitted, items/{id}/children otherwise', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return jsonResponse({
        value: [
          {
            id: 'item-1',
            name: 'report.csv',
            size: 1234,
            webUrl: 'https://acme.sharepoint.com/.../report.csv',
            eTag: '"etag-1"',
            lastModifiedDateTime: '2025-01-01T00:00:00Z',
            file: { mimeType: 'text/csv' },
          },
          {
            id: 'item-2',
            name: 'subfolder',
            folder: { childCount: 3 },
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_drive_items',
      args: { siteId: 'site-A' },
      idempotencyKey: 'k1',
    })
    expect(calls[0]).toContain('/sites/site-A/drive/root/children')

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_drive_items',
      args: { siteId: 'site-A', folderId: 'fold-1' },
      idempotencyKey: 'k2',
    })
    expect(calls[1]).toContain('/sites/site-A/drive/items/fold-1/children')

    const data = result.data as {
      items: Array<{ id: string; kind: string; mimeType?: string; childCount?: number }>
    }
    expect(data.items[0]).toMatchObject({ id: 'item-1', kind: 'file', mimeType: 'text/csv' })
    expect(data.items[1]).toMatchObject({ id: 'item-2', kind: 'folder', childCount: 3 })
  })

  it("search_drive escapes single quotes in the q(') argument", async () => {
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'search_drive',
      args: { siteId: 'site-A', query: "drew's notes" },
      idempotencyKey: 'k1',
    })

    // Graph OData escaping: single quote is doubled.
    expect(decodeURIComponent(observedUrl)).toContain("search(q='drew''s notes')")
  })

  it("get_item_content returns decoded text for small text/* files and exposes the item etag", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/content')) {
        return new Response('hello,world\n1,2\n', {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        })
      }
      return jsonResponse({
        id: 'item-1',
        name: 'report.csv',
        size: 17,
        eTag: '"etag-csv"',
        file: { mimeType: 'text/csv' },
        '@microsoft.graph.downloadUrl': 'https://download.example/report.csv',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_item_content',
      args: { siteId: 'site-A', itemId: 'item-1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { binary: boolean; content?: string; mimeType?: string }
    expect(data.binary).toBe(false)
    expect(data.content).toBe('hello,world\n1,2\n')
    expect(data.mimeType).toBe('text/csv')
    expect(result.etag).toBe('"etag-csv"')
  })

  it('get_item_content shortcuts to {binary,downloadUrl} when size exceeds the inline cap', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/content')) {
        throw new Error('should not reach /content path on oversize file')
      }
      return jsonResponse({
        id: 'item-big',
        name: 'huge.bin',
        size: 10 * 1024 * 1024,
        eTag: '"etag-big"',
        file: { mimeType: 'application/octet-stream' },
        '@microsoft.graph.downloadUrl': 'https://download.example/huge.bin',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'get_item_content',
      args: { siteId: 'site-A', itemId: 'item-big' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { binary: boolean; downloadUrl?: string; reason?: string }
    expect(data.binary).toBe(true)
    expect(data.downloadUrl).toBe('https://download.example/huge.bin')
    expect(data.reason).toMatch(/exceeds/i)
  })

  it('upload_file PUTs the small-file content endpoint and surfaces @odata.etag for downstream CAS', async () => {
    let observedUrl = ''
    let observedMethod = ''
    let observedContentType = ''
    let observedBody: Uint8Array | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedMethod = init?.method ?? 'GET'
      const headers = init?.headers as Record<string, string> | undefined
      observedContentType = headers?.['content-type'] ?? ''
      observedBody = init?.body instanceof Uint8Array ? init.body : null
      return jsonResponse({
        id: 'new-item-1',
        name: 'report.csv',
        webUrl: 'https://acme.sharepoint.com/.../report.csv',
        size: 17,
        '@odata.etag': '"new-etag"',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'upload_file',
      args: {
        siteId: 'site-A',
        parentFolderId: 'root',
        filename: 'report.csv',
        content: 'hello,world\n1,2\n',
        contentType: 'text/csv',
      },
      idempotencyKey: 'k1',
    })

    expect(observedMethod).toBe('PUT')
    expect(observedUrl).toBe(
      'https://graph.microsoft.com/v1.0/sites/site-A/drive/root:/report.csv:/content',
    )
    expect(observedContentType).toBe('text/csv')
    expect(observedBody).not.toBeNull()
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('new-item-1')
      expect(result.etagAfter).toBe('"new-etag"')
    }
  })

  it('upload_file resolves a non-root parent into items/{parentFolderId}:/{filename}:/content', async () => {
    let observedUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      observedUrl = String(input)
      return jsonResponse({ id: 'new-item-2', name: 'notes.md', '@odata.etag': '"e2"' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'upload_file',
      args: {
        siteId: 'site-A',
        parentFolderId: 'parent-folder-7',
        filename: 'notes.md',
        content: '# hi',
        contentType: 'text/markdown',
      },
      idempotencyKey: 'k2',
    })
    expect(observedUrl).toBe(
      'https://graph.microsoft.com/v1.0/sites/site-A/drive/items/parent-folder-7:/notes.md:/content',
    )
  })

  it('upload_file rejects content > MAX_INLINE_BYTES with a simple-upload cap error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('should not be called when size check fails')
      }),
    )
    const huge = 'x'.repeat(4 * 1024 * 1024 + 1)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: {
          siteId: 'site-A',
          parentFolderId: 'root',
          filename: 'huge.txt',
          content: huge,
          contentType: 'text/plain',
        },
        idempotencyKey: 'k1',
      }),
    ).rejects.toThrow(/simple-upload cap/i)
  })

  it("create_folder POSTs the parent's children with conflictBehavior:'fail' and surfaces etag", async () => {
    let observedUrl = ''
    let observedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = String(input)
      observedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({
        id: 'folder-1',
        name: 'reports',
        webUrl: 'https://acme.sharepoint.com/.../reports',
        '@odata.etag': '"folder-etag"',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_folder',
      args: { siteId: 'site-A', parentFolderId: 'root', name: 'reports' },
      idempotencyKey: 'k1',
    })

    expect(observedUrl).toBe('https://graph.microsoft.com/v1.0/sites/site-A/drive/root/children')
    expect(observedBody).toEqual({
      name: 'reports',
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { id: string }).id).toBe('folder-1')
      expect(result.etagAfter).toBe('"folder-etag"')
    }
  })

  it('create_folder maps 409 to ResourceContention', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_folder',
        args: { siteId: 'site-A', parentFolderId: 'root', name: 'dupe' },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'ResourceContention' })
  })

  it('mutations map 401 to CredentialsExpired', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: {
          siteId: 'site-A',
          parentFolderId: 'root',
          filename: 'x.txt',
          content: 'hi',
        },
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('test() returns ok when Graph /sites/root responds 200', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'root-site' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out).toEqual({ ok: true })
  })

  it('test() reports a reconnect reason when Graph rejects the token', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await adapter.test(source())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/reconnect required/i)
  })
})
