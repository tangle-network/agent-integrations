import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  gmail,
  type GmailDownloadAttachmentResult,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gmail_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gmail',
    label: 'Drew Inbox',
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
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

describe('gmail adapter', () => {
  const adapter = gmail({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list_messages requests metadata headers and returns summaries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'next' })
      }
      if (url.includes('/messages/m1?format=metadata')) {
        // Gmail's metadata format returns only the headers the request names.
        const named = new Set(new URL(url).searchParams.getAll('metadataHeaders'))
        return jsonResponse({
          id: 'm1',
          threadId: 't1',
          snippet: 'hi',
          internalDate: '1700000000000',
          labelIds: ['INBOX'],
          payload: {
            headers: [
              { name: 'From', value: 'a@b.com' },
              { name: 'To', value: 'c@d.com' },
              { name: 'Subject', value: 'Hello' },
              { name: 'Date', value: 'Wed, 1 Jan 2025 00:00:00 +0000' },
              { name: 'X-Tangle-Security-Mail', value: '1' },
            ].filter((h) => named.has(h.name)),
          },
        })
      }
      throw new Error('unexpected url ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_messages',
      args: { labelIds: ['INBOX'], maxResults: 1 },
      idempotencyKey: 'k1',
    })
    const data = result.data as { messages: Array<{ from?: string; subject?: string }>; nextPageToken?: string }
    expect(data.nextPageToken).toBe('next')
    expect(data.messages).toHaveLength(1)
    expect(data.messages[0]).toMatchObject({
      from: 'a@b.com',
      subject: 'Hello',
      tangleSecurityMail: '1',
    })
  })

  it('read_message parses text+html bodies and attachment manifest', async () => {
    const textBase64 = Buffer.from('plain body').toString('base64').replace(/=+$/, '')
    const htmlBase64 = Buffer.from('<p>html body</p>').toString('base64').replace(/=+$/, '')
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: 'm1',
        threadId: 't1',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'a@b.com' },
            { name: 'Subject', value: 'Hi' },
            { name: 'x-tangle-security-mail', value: '1' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: textBase64, size: 10 } },
            { mimeType: 'text/html', body: { data: htmlBase64, size: 16 } },
            { filename: 'invoice.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 1024 } },
          ],
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'read_message',
      args: { id: 'm1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as {
      body: { text?: string; html?: string }
      attachments: Array<{ filename: string }>
      tangleSecurityMail?: string
    }
    expect(data.tangleSecurityMail).toBe('1')
    expect(data.body.text).toBe('plain body')
    expect(data.body.html).toBe('<p>html body</p>')
    expect(data.attachments).toHaveLength(1)
    expect(data.attachments[0].filename).toBe('invoice.pdf')
  })

  it('discovers download_attachment with exact inputs and only gmail.readonly', () => {
    const capability = adapter.manifest.capabilities.find(({ name }) => name === 'download_attachment')
    expect(capability).toMatchObject({
      class: 'read',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      parameters: {
        type: 'object',
        required: ['messageId', 'attachmentId'],
      },
    })
    expect(Object.keys(capability!.parameters.properties ?? {})).toEqual(['messageId', 'attachmentId'])
  })

  it('download_attachment returns non-UTF8 bytes as standard base64 without credential extras', async () => {
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0xfb, 0xff, 0xef, 0x41])
    let calledUrl = ''
    let authorization = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return jsonResponse({ size: bytes.byteLength, data: bytes.toString('base64url') })
    }))

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'message/1', attachmentId: 'attachment/1' },
      idempotencyKey: 'k1',
    })
    expect(calledUrl).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/message%2F1/attachments/attachment%2F1')
    expect(authorization).toBe('Bearer at')
    const data = result.data as GmailDownloadAttachmentResult
    expect(data).toEqual({
      messageId: 'message/1',
      attachmentId: 'attachment/1',
      size: bytes.byteLength,
      contentBytes: bytes.toString('base64'),
    })
    expect(Buffer.from(data.contentBytes, 'base64').equals(bytes)).toBe(true)
    expect(Object.keys(data)).toEqual(['messageId', 'attachmentId', 'size', 'contentBytes'])
    expect(JSON.stringify(data)).not.toMatch(/"at"|"rt"|"sec"|accessToken|refreshToken|clientSecret/)
  })

  it('download_attachment accepts exactly 25 MiB', async () => {
    const bytes = Buffer.alloc(25 * 1024 * 1024, 0x5a)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      size: bytes.byteLength,
      data: bytes.toString('base64url'),
    })))

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as GmailDownloadAttachmentResult
    expect(data.size).toBe(25 * 1024 * 1024)
    expect(data.contentBytes).toHaveLength(4 * Math.ceil(bytes.byteLength / 3))
    expect(Buffer.from(data.contentBytes, 'base64').equals(bytes)).toBe(true)
  }, 20_000)

  it('download_attachment rejects declared oversize before decoding data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ size: 25 * 1024 * 1024 + 1, data: 'AA' })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/attachment exceeds 26214400 byte limit/)
  })

  it('download_attachment rejects decoded oversize', async () => {
    const bytes = Buffer.alloc(25 * 1024 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      size: 25 * 1024 * 1024,
      data: bytes.toString('base64url'),
    })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/attachment exceeds 26214400 byte limit/)
  }, 20_000)

  it('download_attachment rejects an oversized Content-Length before reading the body', async () => {
    const response = new Response('{}', {
      headers: { 'content-length': String(36 * 1024 * 1024) },
    })
    const cancel = vi.spyOn(response.body!, 'cancel')
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/provider response exceeds .* byte limit/)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('download_attachment stops buffering an oversized streamed JSON response', async () => {
    let reads = 0
    const chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1
        if (reads === 36) controller.close()
        else controller.enqueue(chunk)
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/provider response exceeds .* byte limit/)
    expect(reads).toBeLessThan(36)
  })

  it.each([
    ['invalid JSON', new Response('{')],
    ['missing data', jsonResponse({ size: 1 })],
    ['invalid size', jsonResponse({ size: '1', data: 'AA' })],
    ['negative size', jsonResponse({ size: -1, data: '' })],
  ])('download_attachment rejects malformed payload: %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/malformed/)
  })

  it.each(['AA==', 'AA+/', 'A', 'A A', 'AB'])('download_attachment rejects invalid base64url %s', async (data) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ size: 1, data })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/malformed base64url/)
  })

  it('download_attachment rejects declared and decoded size mismatches', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ size: 2, data: 'AA' })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/declared size 2 does not match decoded size 1/)
  })

  it.each([
    [401, { error: { status: 'UNAUTHENTICATED' } }, 'CredentialsExpired'],
    [403, { error: { status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'quotaExceeded' }] } }, 'ProviderRateLimited'],
    [429, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'ProviderRateLimited'],
    [500, { error: { message: 'provider failed' } }, 'Error'],
  ])('download_attachment classifies provider error %i', async (status, body, name) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, { status })))
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toMatchObject({ name })
  })

  it('download_attachment reports a missing attachment and validates required identifiers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/attachment a1 on message m1 not found/)
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: '', attachmentId: 'a1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/`messageId` is required/)
    await expect(adapter.executeRead!({
      source: source(),
      capabilityName: 'download_attachment',
      args: { messageId: 'm1' },
      idempotencyKey: 'k1',
    })).rejects.toThrow(/`attachmentId` is required/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('send_reply pulls In-Reply-To from the last thread message', async () => {
    let sendBody: { raw: string; threadId: string } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/threads/t1?format=metadata')) {
        return jsonResponse({
          messages: [
            {
              id: 'm1',
              threadId: 't1',
              payload: {
                headers: [
                  { name: 'From', value: 'sender@example.com' },
                  { name: 'To', value: 'me@me.com' },
                  { name: 'Subject', value: 'Original' },
                  { name: 'Message-ID', value: '<m1@mail>' },
                ],
              },
            },
          ],
        })
      }
      if (url.endsWith('/messages/send')) {
        sendBody = JSON.parse(init!.body as string)
        return jsonResponse({ id: 'sent1', threadId: 't1', labelIds: ['SENT'] })
      }
      throw new Error('unexpected url ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_reply',
      args: { threadId: 't1', body: 'Reply body' },
      idempotencyKey: 'idemp-1',
    })
    expect(result.status).toBe('committed')
    const decoded = Buffer.from(sendBody!.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    expect(decoded).toContain('To: sender@example.com')
    expect(decoded).toContain('Subject: Re: Original')
    expect(decoded).toContain('In-Reply-To: <m1@mail>')
    expect(decoded).toContain('X-Tangle-Idempotency-Key: idemp-1')
    expect(decoded).toContain('Reply body')
  })

  // Issue #67: agents need to send fresh outbound mail too, not just replies.
  it('send constructs a fresh RFC2822 message without thread context', async () => {
    let sendBody: { raw: string; threadId?: string } | null = null
    let fetchedAnyThread = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/threads/')) {
        fetchedAnyThread = true
      }
      if (url.endsWith('/messages/send')) {
        sendBody = JSON.parse(init!.body as string)
        return jsonResponse({ id: 'sent-new-1', threadId: 'thread-new-1', labelIds: ['SENT'] })
      }
      throw new Error('unexpected url ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send',
      args: { to: 'someone@example.com', subject: 'Hello', body: 'Hi there' },
      idempotencyKey: 'idemp-send-1',
    })
    expect(result.status).toBe('committed')
    expect(fetchedAnyThread).toBe(false)
    expect(sendBody!.threadId).toBeUndefined()
    const decoded = Buffer.from(
      sendBody!.raw.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8')
    expect(decoded).toContain('To: someone@example.com')
    expect(decoded).toContain('Subject: Hello')
    expect(decoded).toContain('X-Tangle-Idempotency-Key: idemp-send-1')
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(decoded).not.toContain('In-Reply-To:')
    expect(decoded).not.toContain('References:')
    expect(decoded).toContain('Hi there')
  })

  it('send joins multiple recipients + cc + bcc into RFC2822 headers', async () => {
    let sendBody: { raw: string } | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/messages/send')) {
        sendBody = JSON.parse(init!.body as string)
        return jsonResponse({ id: 'sent2', threadId: 't2', labelIds: ['SENT'] })
      }
      throw new Error('unexpected url ' + url)
    }))

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send',
      args: {
        to: ['one@example.com', 'two@example.com'],
        cc: ['cc1@example.com'],
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        replyTo: 'reply@example.com',
        subject: 'Multi',
        body: 'body',
      },
      idempotencyKey: 'k',
    })
    const decoded = Buffer.from(
      sendBody!.raw.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8')
    expect(decoded).toContain('To: one@example.com, two@example.com')
    expect(decoded).toContain('Cc: cc1@example.com')
    expect(decoded).toContain('Bcc: bcc1@example.com, bcc2@example.com')
    expect(decoded).toContain('Reply-To: reply@example.com')
  })

  it('send uses text/html Content-Type when html=true', async () => {
    let sendBody: { raw: string } | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/messages/send')) {
        sendBody = JSON.parse(init!.body as string)
        return jsonResponse({ id: 's', threadId: 't', labelIds: [] })
      }
      throw new Error('unexpected')
    }))

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send',
      args: { to: 'a@b.com', subject: 's', body: '<p>hi</p>', html: true },
      idempotencyKey: 'k',
    })
    const decoded = Buffer.from(
      sendBody!.raw.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8')
    expect(decoded).toContain('Content-Type: text/html; charset="UTF-8"')
    expect(decoded).toContain('<p>hi</p>')
  })

  it('send rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send',
        args: { subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`to` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send',
        args: { to: [], subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`to` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send',
        args: { to: 'a@b.com', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`subject` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send',
        args: { to: 'a@b.com', subject: 's' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`body` is required/)
  })

  it('send surfaces CredentialsExpired on 401/403', async () => {
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
        capabilityName: 'send',
        args: { to: 'a@b.com', subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('list_messages surfaces ProviderConfigError on a 403 accessNotConfigured (no reconnect)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          errors: [{ reason: 'accessNotConfigured', message: 'Gmail API has not been used in project …' }],
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )))
    await expect(
      adapter.executeRead!({ source: source(), capabilityName: 'list_messages', args: {}, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ name: 'ProviderConfigError', status: 403, reason: 'accessNotConfigured' })
  })

  it('list_messages surfaces ProviderRateLimited on a 403 dailyLimitExceeded (quota, not auth)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: 403,
          status: 'RESOURCE_EXHAUSTED',
          errors: [{ reason: 'dailyLimitExceeded', message: 'Daily Limit Exceeded' }],
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )))
    await expect(
      adapter.executeRead!({ source: source(), capabilityName: 'list_messages', args: {}, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ name: 'ProviderRateLimited', status: 403, reason: 'dailyLimitExceeded' })
  })

  it('watch_label forwards topicName and historyId back', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ historyId: 'h1', expiration: '1700000000000' }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'watch_label',
      args: { topicName: 'projects/p/topics/t', labelIds: ['INBOX'] },
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { historyId: string }).historyId).toBe('h1')
    }
  })
})
