import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  googleDrive,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(
  overrides: Partial<ResolvedDataSource> = {},
  credOverrides: { expired?: boolean } = {},
): ResolvedDataSource {
  return {
    id: 'src_drive_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'google-drive',
    label: 'Drew Drive',
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
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

describe('google-drive adapter', () => {
  const adapter = googleDrive({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes list_files, read_file, watch_folder + write capabilities', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'create_folder',
      'delete_file',
      'list_files',
      'move_file',
      'read_file',
      'upload_file',
      'watch_folder',
    ])
  })

  it('gates watch_folder behind the drive scope', () => {
    const watch = adapter.manifest.capabilities.find((c) => c.name === 'watch_folder')!
    expect(watch.class).toBe('mutation')
    expect(watch.requiredScopes).toContain('https://www.googleapis.com/auth/drive')
  })

  it('gates write capabilities behind drive.file and includes it in default scopes', () => {
    const WRITE = 'https://www.googleapis.com/auth/drive.file'
    const auth = adapter.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind === 'oauth2') {
      expect(auth.scopes).toContain(WRITE)
    }
    for (const name of ['upload_file', 'create_folder', 'delete_file', 'move_file']) {
      const cap = adapter.manifest.capabilities.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      expect(cap.requiredScopes).toContain(WRITE)
      expect((cap as { cas?: string }).cas).toBe('native-idempotency')
      expect((cap as { externalEffect?: boolean }).externalEffect).toBe(true)
    }
  })

  it('list_files emits a folder + non-trashed query and returns the file list', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('drive/v3/files')
      const q = new URL(url).searchParams.get('q')!
      expect(q).toContain("'fld_123' in parents")
      expect(q).toContain('trashed = false')
      return jsonResponse({ files: [{ id: 'f1', name: 'NDA.pdf', mimeType: 'application/pdf' }] })
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

  it('read_file exports Google Docs to text/plain by default', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('?fields=id,name,mimeType,modifiedTime')) {
        return jsonResponse({ id: 'f1', name: 'Brief.docx', mimeType: 'application/vnd.google-apps.document' })
      }
      if (url.includes('/export?mimeType=')) {
        expect(decodeURIComponent(new URL(url).searchParams.get('mimeType')!)).toBe('text/plain')
        return new Response('Hello world', { status: 200, headers: { 'content-type': 'text/plain' } })
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
    expect((result.data as { content: string; encoding: string }).content).toBe('Hello world')
    expect((result.data as { encoding: string }).encoding).toBe('utf-8')
  })

  it('read_file base64-encodes binary downloads', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('?fields=id,name,mimeType,modifiedTime')) {
        return jsonResponse({ id: 'f1', name: 'photo.jpg', mimeType: 'image/jpeg' })
      }
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'read_file',
      args: { fileId: 'f1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as { content: string; encoding: string }
    expect(data.encoding).toBe('base64')
    expect(Buffer.from(data.content, 'base64').toString('hex')).toBe('ffd8ffe0')
  })

  it('watch_folder marks 409 as idempotentReplay using the cached channel', async () => {
    const fetchMock = vi.fn(async () => new Response('conflict', { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source({
        metadata: {
          watchedChannels: { 'chan-1': { resourceId: 'rsrc_abc', expiration: '12345' } },
        },
      }),
      capabilityName: 'watch_folder',
      args: { folderId: 'fld_1', channelId: 'chan-1', address: 'https://hook.example/x' },
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
      expect((result.data as { resourceId: string }).resourceId).toBe('rsrc_abc')
    }
  })

  it('test() returns ok:false on a 401 from Drive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const r = await adapter.test(source())
    expect(r.ok).toBe(false)
  })

  describe('upload_file', () => {
    it('POSTs a multipart upload with metadata + body and returns the new file', async () => {
      let capturedUrl = ''
      let capturedMethod = ''
      let capturedCT = ''
      let capturedBody: Buffer | null = null
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        capturedCT = new Headers(init?.headers as HeadersInit).get('content-type') ?? ''
        capturedBody = Buffer.from(init!.body as ArrayBuffer)
        return jsonResponse({
          id: 'f_new',
          name: 'notes.txt',
          mimeType: 'text/plain',
          parents: ['fld_p'],
          modifiedTime: '2026-01-01T00:00:00Z',
          size: '11',
        })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { name: 'notes.txt', mimeType: 'text/plain', parents: ['fld_p'], content: 'hello world' },
        idempotencyKey: 'k1',
      })
      expect(capturedMethod).toBe('POST')
      expect(capturedUrl).toContain('/upload/drive/v3/files?uploadType=multipart')
      expect(capturedCT).toMatch(/^multipart\/related; boundary=/)
      const bodyStr = capturedBody!.toString('utf-8')
      expect(bodyStr).toContain('"name":"notes.txt"')
      expect(bodyStr).toContain('"mimeType":"text/plain"')
      expect(bodyStr).toContain('"parents":["fld_p"]')
      expect(bodyStr).toContain('hello world')
      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect(result.idempotentReplay).toBe(false)
        expect((result.data as { id: string }).id).toBe('f_new')
        expect((result.data as { mimeType: string }).mimeType).toBe('text/plain')
      }
    })

    it('decodes base64 content into the multipart body bytes', async () => {
      let capturedBody: Buffer | null = null
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = Buffer.from(init!.body as ArrayBuffer)
        return jsonResponse({ id: 'f_bin', name: 'pic.png', mimeType: 'image/png' })
      }))
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
      await adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: {
          name: 'pic.png',
          mimeType: 'image/png',
          content: bytes.toString('base64'),
          encoding: 'base64',
        },
        idempotencyKey: 'k',
      })
      // The raw bytes 0xff 0xd8 0xff 0xe0 must appear contiguously in the body.
      const idx = capturedBody!.indexOf(bytes)
      expect(idx).toBeGreaterThan(-1)
    })

    it('rejects missing name + missing content', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'upload_file',
          args: { content: 'x' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/`name` is required/)
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'upload_file',
          args: { name: 'a.txt' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/`content` is required/)
    })

    it('throws CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'upload_file',
          args: { name: 'a.txt', content: 'b' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })

    it('throws ProviderConfigError on a bare 403 (not a reconnect)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'upload_file',
          args: { name: 'a.txt', content: 'b' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
    })
  })

  describe('create_folder', () => {
    it('POSTs with the folder mimeType and returns the new folder id', async () => {
      let capturedUrl = ''
      let capturedBody: Record<string, unknown> | null = null
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedBody = JSON.parse(init!.body as string)
        return jsonResponse({
          id: 'fld_new',
          name: 'Reports',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['fld_root'],
        })
      }))
      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_folder',
        args: { name: 'Reports', parents: ['fld_root'] },
        idempotencyKey: 'k1',
      })
      expect(capturedUrl).toContain('drive/v3/files')
      expect(capturedBody).toMatchObject({
        name: 'Reports',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['fld_root'],
      })
      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect((result.data as { id: string }).id).toBe('fld_new')
        expect(result.idempotentReplay).toBe(false)
      }
    })

    it('rejects missing name', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'create_folder',
          args: {},
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/`name` is required/)
    })

    it('throws CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'create_folder',
          args: { name: 'x' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })

  describe('delete_file', () => {
    it('DELETEs the file by id and reports committed', async () => {
      let capturedUrl = ''
      let capturedMethod = ''
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        return new Response(null, { status: 204 })
      }))
      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_file',
        args: { fileId: 'f_doomed' },
        idempotencyKey: 'k1',
      })
      expect(capturedMethod).toBe('DELETE')
      expect(capturedUrl).toContain('/files/f_doomed')
      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect((result.data as { fileId: string; deleted: boolean })).toEqual({
          fileId: 'f_doomed',
          deleted: true,
        })
      }
    })

    it('rejects missing fileId', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'delete_file',
          args: {},
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/`fileId` is required/)
    })

    it('throws ProviderConfigError on a bare 403 (not a reconnect)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('forbidden', { status: 403 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'delete_file',
          args: { fileId: 'f1' },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403 })
    })
  })

  describe('move_file', () => {
    it('PATCHes with addParents + removeParents on the query string', async () => {
      let capturedUrl = ''
      let capturedMethod = ''
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        return jsonResponse({
          id: 'f_moved',
          name: 'Q3.pdf',
          parents: ['fld_dst'],
          modifiedTime: '2026-02-01T00:00:00Z',
        })
      }))
      const result = await adapter.executeMutation!({
        source: source(),
        capabilityName: 'move_file',
        args: { fileId: 'f_moved', addParents: ['fld_dst'], removeParents: ['fld_src'] },
        idempotencyKey: 'k1',
      })
      expect(capturedMethod).toBe('PATCH')
      expect(capturedUrl).toContain('/files/f_moved')
      const params = new URL(capturedUrl).searchParams
      expect(params.get('addParents')).toBe('fld_dst')
      expect(params.get('removeParents')).toBe('fld_src')
      expect(result.status).toBe('committed')
      if (result.status === 'committed') {
        expect((result.data as { parents: string[] }).parents).toEqual(['fld_dst'])
        expect(result.idempotentReplay).toBe(false)
      }
    })

    it('rejects missing fileId', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'move_file',
          args: { addParents: ['fld_dst'] },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/`fileId` is required/)
    })

    it('rejects when neither addParents nor removeParents is provided', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'move_file',
          args: { fileId: 'f1' },
          idempotencyKey: 'k',
        }),
      ).rejects.toThrow(/addParents.*removeParents/)
    })

    it('throws CredentialsExpired on 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
      await expect(
        adapter.executeMutation!({
          source: source(),
          capabilityName: 'move_file',
          args: { fileId: 'f1', addParents: ['fld_dst'] },
          idempotencyKey: 'k',
        }),
      ).rejects.toMatchObject({ name: 'CredentialsExpired' })
    })
  })
})
