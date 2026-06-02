import { afterEach, describe, expect, it, vi } from 'vitest'
import { mailchainConnector } from '../src/connectors/adapters/mailchain.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_mailchain_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'mailchain',
    label: 'Mailchain Inbox',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'mc-test-key',
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

describe('mailchain adapter manifest', () => {
  it('classifies itself as the comms category and exposes the mailchain kind', () => {
    expect(mailchainConnector.manifest.kind).toBe('mailchain')
    expect(mailchainConnector.manifest.category).toBe('comms')
    expect(mailchainConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = mailchainConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Mailchain/i)
  })

  it('covers the user, email, and inbox capability surface', () => {
    const names = mailchainConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['email.send', 'messages.inbox.list', 'user.get'])

    const mutations = mailchainConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['email.send'])
  })

  it('exposes messages.inbox.list as a read capability requiring `address`', () => {
    const cap = mailchainConnector.manifest.capabilities.find(
      (c) => c.name === 'messages.inbox.list',
    )
    expect(cap).toBeDefined()
    expect(cap!.class).toBe('read')
    const params = cap!.parameters as { required?: string[]; properties: Record<string, unknown> }
    expect(params.required).toEqual(['address'])
    expect(params.properties).toHaveProperty('address')
    expect(params.properties).toHaveProperty('page')
    expect(params.properties).toHaveProperty('limit')
  })
})

describe('mailchain adapter messages.inbox.list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs /v0/messages with address/page/limit and returns the messages array', async () => {
    let observedUrl: URL | null = null
    let observedMethod: string | undefined
    let observedAuth: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedUrl = input instanceof URL ? input : new URL(String(input))
      observedMethod = init?.method
      const headers = init?.headers as Record<string, string> | undefined
      observedAuth = headers?.authorization ?? null
      return jsonResponse({
        messages: [
          { id: 'msg-1', subject: 'Hi' },
          { id: 'msg-2', subject: 'Hello' },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await mailchainConnector.executeRead!({
      source: source(),
      capabilityName: 'messages.inbox.list',
      args: { address: 'alice@mailchain.com', page: 2, limit: 25 },
      idempotencyKey: 'k-inbox-1',
    })

    expect(observedMethod ?? 'GET').toBe('GET')
    expect(observedUrl!.pathname).toBe('/v0/messages')
    expect(observedUrl!.searchParams.get('address')).toBe('alice@mailchain.com')
    expect(observedUrl!.searchParams.get('page')).toBe('2')
    expect(observedUrl!.searchParams.get('limit')).toBe('25')
    expect(observedAuth).toBe('Bearer mc-test-key')

    const data = result.data as { messages: Array<{ id: string }> }
    expect(Array.isArray(data.messages)).toBe(true)
    expect(data.messages).toHaveLength(2)
    expect(data.messages[0]!.id).toBe('msg-1')
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('declares `address` as a required parameter on the manifest schema', () => {
    // The declarative-rest engine delegates required-arg enforcement to the
    // upper layer's JSON Schema validator; the manifest is the contract.
    const cap = mailchainConnector.manifest.capabilities.find(
      (c) => c.name === 'messages.inbox.list',
    )!
    const params = cap.parameters as { required: string[] }
    expect(params.required).toContain('address')
  })

  it('omits optional query params when not supplied', async () => {
    let observedUrl: URL | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        observedUrl = input instanceof URL ? input : new URL(String(input))
        return jsonResponse({ messages: [] })
      }),
    )
    await mailchainConnector.executeRead!({
      source: source(),
      capabilityName: 'messages.inbox.list',
      args: { address: 'bob@mailchain.com' },
      idempotencyKey: 'k',
    })
    expect(observedUrl!.searchParams.get('address')).toBe('bob@mailchain.com')
    expect(observedUrl!.searchParams.has('page')).toBe(false)
    expect(observedUrl!.searchParams.has('limit')).toBe(false)
  })

  it('surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', {
      status: 401,
      headers: { 'content-type': 'text/plain' },
    })))
    await expect(
      mailchainConnector.executeRead!({
        source: source(),
        capabilityName: 'messages.inbox.list',
        args: { address: 'alice@mailchain.com' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
