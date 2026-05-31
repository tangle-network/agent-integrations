import { afterEach, describe, expect, it, vi } from 'vitest'
import { postmarkConnector } from '../src/connectors/adapters/postmark.js'
import type { ConnectorInvocation, ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'source_postmark',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'postmark',
  label: 'postmark',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'pm_server_token_xyz' },
  status: 'active',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetch(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(
    async (_input: URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { 'content-type': 'application/json', ...init.headers },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('postmark adapter manifest', () => {
  it('identifies as a comms api-key connector with kind=postmark', () => {
    expect(postmarkConnector.manifest.kind).toBe('postmark')
    expect(postmarkConnector.manifest.category).toBe('comms')
    expect(postmarkConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a hint pointing at the X-Postmark-Server-Token header', () => {
    const auth = postmarkConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/X-Postmark-Server-Token/)
    expect(auth.hint).toMatch(/Server API token/)
  })

  it('covers the server-token transactional surface — sends, batch, template, search, bounces, stats, templates', () => {
    const names = postmarkConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'bounces.activate',
        'bounces.get',
        'bounces.search',
        'email.send',
        'email.send.batch',
        'email.send.template',
        'email.send.template.batch',
        'messages.outbound.get',
        'messages.outbound.search',
        'server.get',
        'stats.outbound.overview',
        'templates.create',
        'templates.get',
        'templates.list',
      ].sort(),
    )
  })

  it('marks every send/template mutation as an external effect', () => {
    const mutations = postmarkConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('unreachable')
      expect(m.externalEffect).toBe(true)
    }
  })
})

describe('postmark adapter execution', () => {
  it('sends a single email via POST /email with the server-token header', async () => {
    const fetchMock = mockFetch({ MessageID: 'abc-123', ErrorCode: 0, Message: 'OK', SubmittedAt: '2026-01-01T00:00:00Z', To: 'a@b.co' })
    const inv: ConnectorInvocation = {
      source,
      capabilityName: 'email.send',
      args: {
        From: 'sender@example.com',
        To: 'recipient@example.com',
        Subject: 'hi',
        TextBody: 'hello',
      },
      idempotencyKey: 'k1',
    }

    const result = await postmarkConnector.executeMutation!(inv)
    expect(result.status).toBe('committed')

    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.postmarkapp.com/email')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('pm_server_token_xyz')
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
    expect(JSON.parse(String(init.body))).toEqual({
      From: 'sender@example.com',
      To: 'recipient@example.com',
      Subject: 'hi',
      TextBody: 'hello',
    })
  })

  it('unwraps batch sends so the upstream gets a raw array body', async () => {
    const fetchMock = mockFetch([{ MessageID: '1' }, { MessageID: '2' }])
    const inv: ConnectorInvocation = {
      source,
      capabilityName: 'email.send.batch',
      args: {
        Messages: [
          { From: 'a@x.co', To: 'b@y.co', Subject: 'one', TextBody: '1' },
          { From: 'a@x.co', To: 'c@y.co', Subject: 'two', TextBody: '2' },
        ],
      },
      idempotencyKey: 'k2',
    }

    await postmarkConnector.executeMutation!(inv)
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({ From: 'a@x.co', To: 'b@y.co' })
  })

  it('renders search query params and skips undefined filters', async () => {
    const fetchMock = mockFetch({ TotalCount: 0, Messages: [] })
    const inv: ConnectorInvocation = {
      source,
      capabilityName: 'messages.outbound.search',
      args: { count: 25, status: 'sent', tag: 'welcome' },
      idempotencyKey: 'k3',
    }

    await postmarkConnector.executeRead!(inv)
    const url = String((fetchMock.mock.calls[0] as [URL | string, RequestInit])[0])
    expect(url).toContain('count=25')
    expect(url).toContain('status=sent')
    expect(url).toContain('tag=welcome')
    expect(url).not.toContain('recipient=')
    expect(url).not.toContain('offset=')
  })

  it('interpolates path params for outbound message details', async () => {
    const fetchMock = mockFetch({ MessageID: 'xyz', To: [{ Email: 'r@x.co' }] })
    const inv: ConnectorInvocation = {
      source,
      capabilityName: 'messages.outbound.get',
      args: { messageId: 'xyz-uuid' },
      idempotencyKey: 'k4',
    }

    await postmarkConnector.executeRead!(inv)
    const url = String((fetchMock.mock.calls[0] as [URL | string, RequestInit])[0])
    expect(url).toBe('https://api.postmarkapp.com/messages/outbound/xyz-uuid/details')
  })

  it('hits the test probe at GET /server', async () => {
    const fetchMock = mockFetch({ ID: 1, Name: 'my-server' })
    const probe = await postmarkConnector.test!(source)
    expect(probe.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [URL | string, RequestInit]
    expect(String(url)).toBe('https://api.postmarkapp.com/server')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe('pm_server_token_xyz')
  })

  it('surfaces a CredentialsExpired-class failure on 401 from the probe', async () => {
    mockFetch({ ErrorCode: 10, Message: 'Invalid token' }, { status: 401 })
    const probe = await postmarkConnector.test!(source)
    expect(probe.ok).toBe(false)
  })
})
