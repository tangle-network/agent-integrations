import { afterEach, describe, expect, it, vi } from 'vitest'
import { freeAgentConnector } from '../src/connectors/adapters/free-agent.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_free_agent_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'free-agent',
    label: 'FreeAgent test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'fa-token' },
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

describe('free-agent adapter manifest', () => {
  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = freeAgentConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

})

describe('free-agent invoices.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /invoices with the invoice payload nested under `invoice`', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ invoice: { url: 'https://api.freeagent.com/v2/invoices/1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freeAgentConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.create',
      args: {
        invoice: {
          contact: 'https://api.freeagent.com/v2/contacts/9',
          dated_on: '2026-06-01',
        },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.freeagent.com/v2/invoices')
    expect(requestBody).toEqual({
      invoice: {
        contact: 'https://api.freeagent.com/v2/contacts/9',
        dated_on: '2026-06-01',
      },
    })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      freeAgentConnector.executeMutation!({
        source: source(),
        capabilityName: 'invoices.create',
        args: { invoice: { contact: 'x' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('free-agent invoices.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /invoices/{invoiceId}/send_email with the email override', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ sent: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freeAgentConnector.executeMutation!({
      source: source(),
      capabilityName: 'invoices.send',
      args: {
        invoiceId: 'inv_42',
        email: { recipient: 'drew@example.com', subject: 'Invoice 42' },
      },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe(
      'https://api.freeagent.com/v2/invoices/inv_42/send_email',
    )
    expect(requestBody).toMatchObject({
      email: { recipient: 'drew@example.com', subject: 'Invoice 42' },
    })
  })
})

describe('free-agent contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE against /contacts/{contactId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await freeAgentConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contactId: '9' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.freeagent.com/v2/contacts/9')
  })
})
