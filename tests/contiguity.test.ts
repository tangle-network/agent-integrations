import { afterEach, describe, expect, it, vi } from 'vitest'
import { contiguityConnector } from '../src/connectors/adapters/contiguity.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_contiguity_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'contiguity',
    label: 'contiguity test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'contiguity_secret' },
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

describe('contiguity adapter manifest', () => {
  it('classifies itself as the crm category and exposes the contiguity kind', () => {
    expect(contiguityConnector.manifest.kind).toBe('contiguity')
    expect(contiguityConnector.manifest.category).toBe('crm')
    expect(contiguityConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    expect(contiguityConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes send-message capabilities including the canonical sms.send and email.send', () => {
    const names = contiguityConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['email.send', 'messages.send_imessage', 'messages.send_text', 'sms.send'].sort(),
    )
    const mutations = contiguityConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['email.send', 'messages.send_imessage', 'messages.send_text', 'sms.send'].sort(),
    )
  })

  it('marks newly added mutations as native-idempotency external effects', () => {
    const added = contiguityConnector.manifest.capabilities.filter(
      (c) => c.name === 'email.send' || c.name === 'sms.send',
    )
    expect(added).toHaveLength(2)
    for (const cap of added) {
      if (cap.class !== 'mutation') throw new Error(`${cap.name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('contiguity email.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/send/email with bearer auth and the assembled JSON body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestHeaders: Record<string, string> = {}
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      )
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'msg_email_1', status: 'queued' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await contiguityConnector.executeMutation!({
      source: source(),
      capabilityName: 'email.send',
      args: {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'hello',
        body: 'world',
        contentType: 'text/plain',
        replyTo: 'reply@example.com',
      },
      idempotencyKey: 'k-email-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/send/email')
    expect(requestHeaders.authorization).toBe('Bearer contiguity_secret')
    expect(requestBody).toEqual({
      to: 'recipient@example.com',
      from: 'sender@example.com',
      subject: 'hello',
      body: 'world',
      contentType: 'text/plain',
      replyTo: 'reply@example.com',
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      contiguityConnector.executeMutation!({
        source: source(),
        capabilityName: 'email.send',
        args: {
          to: 'recipient@example.com',
          from: 'sender@example.com',
          subject: 'hello',
          body: 'world',
          contentType: 'text/plain',
          replyTo: 'reply@example.com',
        },
        idempotencyKey: 'k-email-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('contiguity sms.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/messages/send/text with the SMS payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'msg_sms_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await contiguityConnector.executeMutation!({
      source: source(),
      capabilityName: 'sms.send',
      args: { to: '+15551234567', from: '+15557654321', message: 'hey there' },
      idempotencyKey: 'k-sms-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/messages/send/text')
    expect(requestBody).toMatchObject({ to: '+15551234567', from: '+15557654321', message: 'hey there' })
  })
})
