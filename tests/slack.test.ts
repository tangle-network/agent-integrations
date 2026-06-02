import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  slack,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_slack_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'slack',
    label: 'Drew Workspace',
    consistencyModel: 'advisory',
    scopes: ['chat:write'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'xoxb-test',
      refreshToken: undefined,
      expiresAt: undefined,
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

describe('slack adapter', () => {
  const adapter = slack({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes the read + mutation surface', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'add_reaction',
      'delete_message',
      'list_channels',
      'lookup_user',
      'post_in_thread',
      'post_message',
      'update_message',
      'upload_file',
    ])
  })

  it('post_in_thread requires channel + thread_ts and threads under parent', async () => {
    let postBody: { channel: string; thread_ts: string; text?: string; blocks?: unknown[] } | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/chat.postMessage')) {
        postBody = JSON.parse(init!.body as string)
        return jsonResponse({ ok: true, ts: '1700000000.000200', channel: 'C123' })
      }
      throw new Error('unexpected url ' + url)
    }))

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'post_in_thread',
      args: { channel: 'C123', thread_ts: '1700000000.000100', text: 'reply' },
      idempotencyKey: 'k-thread-1',
    })
    expect(result.status).toBe('committed')
    expect(postBody!.channel).toBe('C123')
    expect(postBody!.thread_ts).toBe('1700000000.000100')
    expect(postBody!.text).toBe('reply')
    if (result.status === 'committed') {
      const data = result.data as { ts: string; channel: string; thread_ts: string }
      expect(data.ts).toBe('1700000000.000200')
      expect(data.thread_ts).toBe('1700000000.000100')
    }
  })

  it('post_in_thread rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'post_in_thread',
        args: { thread_ts: 'x', text: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channel` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'post_in_thread',
        args: { channel: 'C1', text: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`thread_ts` is required/)
  })

  it('post_in_thread surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'unauthorized' }),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'post_in_thread',
        args: { channel: 'C1', thread_ts: '1.2', text: 't' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('update_message POSTs chat.update with channel/ts/text', async () => {
    let body: { channel: string; ts: string; text?: string; blocks?: unknown[] } | null = null
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      body = JSON.parse(init!.body as string)
      return jsonResponse({ ok: true, ts: '1.2', channel: 'C1', text: 'new' })
    }))

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'update_message',
      args: { channel: 'C1', ts: '1.2', text: 'new' },
      idempotencyKey: 'k-up-1',
    })
    expect(calledUrl).toBe('https://slack.com/api/chat.update')
    expect(body!.channel).toBe('C1')
    expect(body!.ts).toBe('1.2')
    expect(body!.text).toBe('new')
    expect(result.status).toBe('committed')
  })

  it('update_message rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_message',
        args: { ts: '1.2', text: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channel` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_message',
        args: { channel: 'C1', text: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`ts` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_message',
        args: { channel: 'C1', ts: '1.2' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`text` or `blocks` is required/)
  })

  it('update_message surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
      text: async () => 'forbidden',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_message',
        args: { channel: 'C1', ts: '1.2', text: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('delete_message POSTs chat.delete with channel/ts', async () => {
    let body: { channel: string; ts: string } | null = null
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      body = JSON.parse(init!.body as string)
      return jsonResponse({ ok: true, ts: '1.2', channel: 'C1' })
    }))

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'delete_message',
      args: { channel: 'C1', ts: '1.2' },
      idempotencyKey: 'k-del-1',
    })
    expect(calledUrl).toBe('https://slack.com/api/chat.delete')
    expect(body!.channel).toBe('C1')
    expect(body!.ts).toBe('1.2')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { ts: string; channel: string }).ts).toBe('1.2')
    }
  })

  it('delete_message rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_message',
        args: { ts: '1.2' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channel` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_message',
        args: { channel: 'C1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`ts` is required/)
  })

  it('delete_message surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'delete_message',
        args: { channel: 'C1', ts: '1.2' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('add_reaction POSTs reactions.add with channel/timestamp/name', async () => {
    let body: { channel: string; timestamp: string; name: string } | null = null
    let calledUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      body = JSON.parse(init!.body as string)
      return jsonResponse({ ok: true })
    }))

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'add_reaction',
      args: { channel: 'C1', timestamp: '1.2', name: 'thumbsup' },
      idempotencyKey: 'k-react-1',
    })
    expect(calledUrl).toBe('https://slack.com/api/reactions.add')
    expect(body!.channel).toBe('C1')
    expect(body!.timestamp).toBe('1.2')
    expect(body!.name).toBe('thumbsup')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('add_reaction treats already_reacted as idempotent replay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ ok: false, error: 'already_reacted' }),
    ))
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'add_reaction',
      args: { channel: 'C1', timestamp: '1.2', name: 'thumbsup' },
      idempotencyKey: 'k',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.idempotentReplay).toBe(true)
    }
  })

  it('add_reaction rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { timestamp: '1.2', name: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channel` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { channel: 'C1', name: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`timestamp` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { channel: 'C1', timestamp: '1.2' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`name` is required/)
  })

  it('add_reaction surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'add_reaction',
        args: { channel: 'C1', timestamp: '1.2', name: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('upload_file walks the v2 two-step flow', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let completeBody: { files: Array<{ id: string; title?: string }>; channel_id: string; initial_comment?: string } | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/api/files.getUploadURLExternal')) {
        return jsonResponse({
          ok: true,
          upload_url: 'https://files.slack.com/upload/abc',
          file_id: 'F123',
        })
      }
      if (url === 'https://files.slack.com/upload/abc') {
        return new Response('OK', { status: 200 })
      }
      if (url.endsWith('/api/files.completeUploadExternal')) {
        completeBody = JSON.parse(init!.body as string)
        return jsonResponse({
          ok: true,
          files: [{ id: 'F123', title: 'note.txt', permalink: 'https://slack.com/file/F123' }],
        })
      }
      throw new Error('unexpected url ' + url)
    }))

    const content = Buffer.from('hello world').toString('base64')
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'upload_file',
      args: {
        channels: ['C1', 'C2'],
        filename: 'note.txt',
        content,
        title: 'note.txt',
        initial_comment: 'fyi',
      },
      idempotencyKey: 'k-up-1',
    })
    expect(calls.map((c) => c.url)).toEqual([
      'https://slack.com/api/files.getUploadURLExternal',
      'https://files.slack.com/upload/abc',
      'https://slack.com/api/files.completeUploadExternal',
    ])
    const reserveBody = JSON.parse(calls[0]!.init!.body as string) as { filename: string; length: number }
    expect(reserveBody.filename).toBe('note.txt')
    expect(reserveBody.length).toBe(Buffer.from('hello world').byteLength)
    expect(completeBody!.files[0]).toMatchObject({ id: 'F123', title: 'note.txt' })
    expect(completeBody!.channel_id).toBe('C1,C2')
    expect(completeBody!.initial_comment).toBe('fyi')
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as { fileId: string; channels: string[]; files: Array<{ id: string }> }
      expect(data.fileId).toBe('F123')
      expect(data.channels).toEqual(['C1', 'C2'])
      expect(data.files[0]!.id).toBe('F123')
    }
  })

  it('upload_file rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { filename: 'f', content: 'AAAA' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channels` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { channels: [], filename: 'f', content: 'AAAA' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`channels` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { channels: ['C1'], content: 'AAAA' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`filename` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { channels: ['C1'], filename: 'f' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`content` is required/)
  })

  it('upload_file surfaces CredentialsExpired when reservation 401s', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/files.getUploadURLExternal')) {
        return {
          ok: false,
          status: 401,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({}),
          text: async () => 'unauthorized',
        } as unknown as Response
      }
      throw new Error('unexpected url ' + url)
    }))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'upload_file',
        args: { channels: ['C1'], filename: 'f', content: 'AAAA' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
