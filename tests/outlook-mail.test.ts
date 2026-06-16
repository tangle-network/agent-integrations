import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  outlookMail,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_outlook_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'outlook-mail',
    label: 'Drew Outlook',
    consistencyModel: 'authoritative',
    scopes: ['https://graph.microsoft.com/Mail.Read'],
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

describe('outlook-mail adapter', () => {
  const adapter = outlookMail({ clientId: 'cid', clientSecret: 'sec' })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest declares Graph OAuth + the four capabilities', () => {
    expect(adapter.manifest.kind).toBe('outlook-mail')
    expect(adapter.manifest.auth.kind).toBe('oauth2')
    if (adapter.manifest.auth.kind === 'oauth2') {
      expect(adapter.manifest.auth.authorizationUrl).toContain('login.microsoftonline.com')
      expect(adapter.manifest.auth.tokenUrl).toContain('login.microsoftonline.com')
      expect(adapter.manifest.auth.clientIdEnv).toBe('MS_OAUTH_CLIENT_ID')
      expect(adapter.manifest.auth.clientSecretEnv).toBe('MS_OAUTH_CLIENT_SECRET')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/Mail.Read')
      expect(adapter.manifest.auth.scopes).toContain('https://graph.microsoft.com/Mail.Send')
      expect(adapter.manifest.auth.scopes).toContain('offline_access')
    }
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'create_draft',
      'download_attachment',
      'forward_message',
      'list_messages',
      'move_message',
      'read_message',
      'send_draft',
      'send_message',
      'send_reply',
      'set_labels',
      'subscribe_folder',
    ])
  })

  it('list_messages selects expected fields and maps summaries', async () => {
    let calledUrl = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calledUrl = String(input)
      return jsonResponse({
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=AAA',
        value: [
          {
            id: 'msg1',
            conversationId: 'conv1',
            subject: 'Hello',
            bodyPreview: 'hi',
            receivedDateTime: '2026-01-01T00:00:00Z',
            isRead: false,
            hasAttachments: true,
            from: { emailAddress: { name: 'A', address: 'a@b.com' } },
            toRecipients: [{ emailAddress: { name: 'C', address: 'c@d.com' } }],
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_messages',
      args: { folder: 'inbox', top: 1 },
      idempotencyKey: 'k1',
    })
    expect(calledUrl).toContain('/me/mailFolders/inbox/messages')
    expect(calledUrl).toContain('%24top=1')
    expect(calledUrl).toContain('%24select=')
    const data = result.data as {
      messages: Array<{ from?: string; subject?: string; to?: string[] }>
      nextLink?: string
    }
    expect(data.messages).toHaveLength(1)
    expect(data.messages[0]).toMatchObject({ from: 'a@b.com', subject: 'Hello', to: ['c@d.com'] })
    expect(data.nextLink).toBeDefined()
  })

  it('list_messages with query uses $search and ConsistencyLevel=eventual', async () => {
    let observed: { url: string; headers: Headers } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observed = { url: String(input), headers: new Headers(init?.headers) }
      return jsonResponse({ value: [] })
    })
    vi.stubGlobal('fetch', fetchMock)

    await adapter.executeRead!({
      source: source(),
      capabilityName: 'list_messages',
      args: { query: 'from:billing@stripe.com' },
      idempotencyKey: 'k1',
    })
    expect(observed!.url).toContain('%24search=')
    // $orderby must be stripped when $search is in play.
    expect(observed!.url).not.toContain('%24orderby')
    expect(observed!.headers.get('consistencylevel')).toBe('eventual')
  })

  it('read_message expands attachments and filters inline parts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('$expand=attachments')
      return jsonResponse({
        id: 'msg1',
        conversationId: 'conv1',
        subject: 'Hi',
        receivedDateTime: '2026-01-01T00:00:00Z',
        from: { emailAddress: { address: 'a@b.com' } },
        toRecipients: [{ emailAddress: { address: 'me@me.com' } }],
        body: { contentType: 'html', content: '<p>hello</p>' },
        attachments: [
          { id: 'att1', name: 'invoice.pdf', contentType: 'application/pdf', size: 1024, isInline: false },
          { id: 'att2', name: 'logo.png', contentType: 'image/png', size: 256, isInline: true },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeRead!({
      source: source(),
      capabilityName: 'read_message',
      args: { id: 'msg1' },
      idempotencyKey: 'k1',
    })
    const data = result.data as {
      body: { contentType: string; content: string }
      attachments: Array<{ id: string; name: string }>
    }
    expect(data.body.contentType).toBe('html')
    expect(data.body.content).toBe('<p>hello</p>')
    expect(data.attachments).toHaveLength(1)
    expect(data.attachments[0]).toMatchObject({ id: 'att1', name: 'invoice.pdf' })
  })

  it('send_reply creates → patches → sends and tags the draft with the idempotency key', async () => {
    let patchBody: { internetMessageHeaders?: Array<{ name: string; value: string }>; body?: { contentType?: string; content?: string } } | null = null
    let sendCalled = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/createReply')) {
        return jsonResponse({ id: 'draft1' })
      }
      if (url.endsWith('/createReplyAll')) {
        return jsonResponse({ id: 'draftAll1' })
      }
      if (url.includes('/messages/draft1') && init?.method === 'PATCH') {
        patchBody = JSON.parse(init.body as string)
        return jsonResponse({})
      }
      if (url.endsWith('/messages/draft1/send')) {
        sendCalled = true
        return new Response(null, { status: 202 })
      }
      throw new Error('unexpected url ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_reply',
      args: { messageId: 'msg1', body: 'Reply body', bodyType: 'text' },
      idempotencyKey: 'idemp-1',
    })
    expect(result.status).toBe('committed')
    expect(sendCalled).toBe(true)
    expect(patchBody!.body).toEqual({ contentType: 'text', content: 'Reply body' })
    expect(patchBody!.internetMessageHeaders).toEqual([
      { name: 'X-Tangle-Idempotency-Key', value: 'idemp-1' },
    ])
  })

  it('subscribe_folder POSTs the right shape and echoes subscription back', async () => {
    let postedBody: { resource?: string; changeType?: string; clientState?: string; expirationDateTime?: string } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/subscriptions')
      postedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'sub-123',
        expirationDateTime: postedBody!.expirationDateTime,
        clientState: postedBody!.clientState,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'subscribe_folder',
      args: { notificationUrl: 'https://hook.example/ms', folder: 'inbox' },
      idempotencyKey: 'k1',
    })
    expect(result.status).toBe('committed')
    expect(postedBody!.changeType).toBe('created')
    expect(postedBody!.resource).toBe("me/mailFolders('inbox')/messages")
    if (result.status === 'committed') {
      expect((result.data as { subscriptionId: string }).subscriptionId).toBe('sub-123')
    }
  })

  it('send_message POSTs /me/sendMail with text body + idempotency-key header', async () => {
    let calledUrl = ''
    let postedBody: {
      saveToSentItems?: boolean
      message?: {
        subject?: string
        body?: { contentType?: string; content?: string }
        toRecipients?: Array<{ emailAddress: { address: string } }>
        ccRecipients?: Array<{ emailAddress: { address: string } }>
        bccRecipients?: Array<{ emailAddress: { address: string } }>
        internetMessageHeaders?: Array<{ name: string; value: string }>
      }
    } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      postedBody = JSON.parse(init!.body as string)
      return new Response(null, { status: 202 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_message',
      args: { to: 'someone@example.com', subject: 'Hello', body: 'Hi there' },
      idempotencyKey: 'idemp-send-1',
    })
    expect(result.status).toBe('committed')
    expect(calledUrl).toContain('/me/sendMail')
    expect(postedBody!.saveToSentItems).toBe(true)
    expect(postedBody!.message!.subject).toBe('Hello')
    expect(postedBody!.message!.body).toEqual({ contentType: 'Text', content: 'Hi there' })
    expect(postedBody!.message!.toRecipients).toEqual([
      { emailAddress: { address: 'someone@example.com' } },
    ])
    expect(postedBody!.message!.internetMessageHeaders).toEqual([
      { name: 'X-Tangle-Idempotency-Key', value: 'idemp-send-1' },
    ])
  })

  it('send_message threads multi-recipient + cc + bcc + html into Graph payload', async () => {
    let postedBody: {
      message?: {
        body?: { contentType?: string }
        toRecipients?: Array<{ emailAddress: { address: string } }>
        ccRecipients?: Array<{ emailAddress: { address: string } }>
        bccRecipients?: Array<{ emailAddress: { address: string } }>
      }
    } | null = null
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      postedBody = JSON.parse(init!.body as string)
      return new Response(null, { status: 202 })
    }))

    await adapter.executeMutation!({
      source: source(),
      capabilityName: 'send_message',
      args: {
        to: ['one@example.com', 'two@example.com'],
        cc: ['cc1@example.com'],
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        subject: 'Multi',
        body: '<p>hi</p>',
        html: true,
      },
      idempotencyKey: 'k',
    })
    expect(postedBody!.message!.body!.contentType).toBe('HTML')
    expect(postedBody!.message!.toRecipients).toEqual([
      { emailAddress: { address: 'one@example.com' } },
      { emailAddress: { address: 'two@example.com' } },
    ])
    expect(postedBody!.message!.ccRecipients).toEqual([
      { emailAddress: { address: 'cc1@example.com' } },
    ])
    expect(postedBody!.message!.bccRecipients).toEqual([
      { emailAddress: { address: 'bcc1@example.com' } },
      { emailAddress: { address: 'bcc2@example.com' } },
    ])
  })

  it('send_message rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send_message',
        args: { subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`to` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send_message',
        args: { to: [], subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`to` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send_message',
        args: { to: 'a@b.com', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`subject` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'send_message',
        args: { to: 'a@b.com', subject: 's' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`body` is required/)
  })

  it('send_message surfaces CredentialsExpired on 401/403', async () => {
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
        capabilityName: 'send_message',
        args: { to: 'a@b.com', subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('create_draft POSTs /me/messages and returns the draft id', async () => {
    let calledUrl = ''
    let calledMethod = ''
    let postedBody: {
      subject?: string
      body?: { contentType?: string; content?: string }
      toRecipients?: Array<{ emailAddress: { address: string } }>
      internetMessageHeaders?: Array<{ name: string; value: string }>
    } | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calledUrl = String(input)
      calledMethod = init?.method ?? ''
      postedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'draft-xyz',
        conversationId: 'conv-1',
        webLink: 'https://outlook.office.com/mail/drafts/id/draft-xyz',
        isDraft: true,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_draft',
      args: { to: 'someone@example.com', subject: 'Draft subj', body: 'Draft body' },
      idempotencyKey: 'idemp-draft-1',
    })
    expect(result.status).toBe('committed')
    expect(calledUrl).toContain('/me/messages')
    expect(calledUrl).not.toContain('/sendMail')
    expect(calledMethod).toBe('POST')
    expect(postedBody!.subject).toBe('Draft subj')
    expect(postedBody!.body).toEqual({ contentType: 'Text', content: 'Draft body' })
    expect(postedBody!.toRecipients).toEqual([
      { emailAddress: { address: 'someone@example.com' } },
    ])
    expect(postedBody!.internetMessageHeaders).toEqual([
      { name: 'X-Tangle-Idempotency-Key', value: 'idemp-draft-1' },
    ])
    if (result.status === 'committed') {
      const data = result.data as { id: string; isDraft: boolean; webLink?: string }
      expect(data.id).toBe('draft-xyz')
      expect(data.isDraft).toBe(true)
      expect(data.webLink).toContain('outlook.office.com')
    }
  })

  it('create_draft rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'x' })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_draft',
        args: { subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`to` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_draft',
        args: { to: 'a@b.com', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`subject` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_draft',
        args: { to: 'a@b.com', subject: 's' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`body` is required/)
  })

  it('create_draft surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'forbidden' }),
      text: async () => 'forbidden',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_draft',
        args: { to: 'a@b.com', subject: 's', body: 'b' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('test() probes /me and returns ok on 200', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/me?$select=id')
      return jsonResponse({ id: 'u1', userPrincipalName: 'drew@tangle.tools' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await adapter.test!(source())
    expect(result.ok).toBe(true)
  })
})
