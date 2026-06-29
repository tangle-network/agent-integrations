import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  gmail,
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

  it('manifest exposes list_messages, read_message, send, send_reply, watch_label', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['list_messages', 'read_message', 'send', 'send_reply', 'watch_label'])
  })

  it('list_messages requests metadata headers and returns summaries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/messages?')) {
        return jsonResponse({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'next' })
      }
      if (url.includes('/messages/m1?format=metadata')) {
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
            ],
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
    expect(data.messages[0]).toMatchObject({ from: 'a@b.com', subject: 'Hello' })
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
    const data = result.data as { body: { text?: string; html?: string }; attachments: Array<{ filename: string }> }
    expect(data.body.text).toBe('plain body')
    expect(data.body.html).toBe('<p>html body</p>')
    expect(data.attachments).toHaveLength(1)
    expect(data.attachments[0].filename).toBe('invoice.pdf')
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
