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

  it('manifest exposes list_files, read_file, watch_folder', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['list_files', 'read_file', 'watch_folder'])
  })

  it('gates watch_folder behind the drive scope', () => {
    const watch = adapter.manifest.capabilities.find((c) => c.name === 'watch_folder')!
    expect(watch.class).toBe('mutation')
    expect(watch.requiredScopes).toContain('https://www.googleapis.com/auth/drive')
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
})
