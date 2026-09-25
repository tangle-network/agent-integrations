import { afterEach, describe, expect, it, vi } from 'vitest'
import { helpscoutConnector } from '../src/connectors/adapters/helpscout.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_helpscout_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'helpscout',
    label: 'helpscout test',
    consistencyModel: 'authoritative',
    scopes: ['tickets.reply.write', 'tickets.search.read'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'hs_test_token',
      refreshToken: 'hs_refresh_token',
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

describe('helpscout adapter manifest', () => {
  it('uses oauth2 auth with Help Scout endpoints', () => {
    const auth = helpscoutConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/secure\.helpscout\.net/)
    expect(auth.tokenUrl).toMatch(/api\.helpscout\.net/)
  })

})

describe('helpscout conversations.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/conversations with the supplied body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string
      return jsonResponse({ id: 12345 }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await helpscoutConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.create',
      args: {
        subject: 'Login broken',
        customer: { email: 'user@example.com' },
        mailboxId: 42,
        type: 'email',
        threads: [{ type: 'customer', customer: { email: 'user@example.com' }, text: 'help!' }],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.helpscout.net/v2/conversations')
    const parsed = JSON.parse(requestBody ?? '{}')
    expect(parsed.subject).toBe('Login broken')
    expect(parsed.mailboxId).toBe(42)
    expect(parsed.type).toBe('email')
    expect(Array.isArray(parsed.threads)).toBe(true)
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      helpscoutConnector.executeMutation!({
        source: source(),
        capabilityName: 'conversations.create',
        args: {
          subject: 'x',
          customer: { email: 'a@b.com' },
          mailboxId: 1,
          type: 'email',
          threads: [{ type: 'customer', text: 'x' }],
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('helpscout conversations.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/conversations/{conversationId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return new Response(null, { status: 204 })
      }),
    )

    const result = await helpscoutConnector.executeMutation!({
      source: source(),
      capabilityName: 'conversations.delete',
      args: { conversationId: '999' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.helpscout.net/v2/conversations/999')
    expect(result.status).toBe('committed')
  })
})
