import { afterEach, describe, expect, it, vi } from 'vitest'
import { gotifyConnector } from '../src/connectors/adapters/gotify.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gotify_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'gotify',
    label: 'gotify test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { base_url: 'https://push.example.com' },
    credentials: { kind: 'api-key', apiKey: 'gotify_secret' },
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

describe('gotify adapter manifest', () => {
  it('classifies itself as the comms category and exposes the gotify kind', () => {
    expect(gotifyConnector.manifest.kind).toBe('gotify')
    expect(gotifyConnector.manifest.category).toBe('comms')
    expect(gotifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = gotifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the original send action plus message.send/delete and application.create', () => {
    const names = gotifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['application.create', 'message.delete', 'message.send', 'notification.send'].sort(),
    )

    const mutations = gotifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['application.create', 'message.delete', 'message.send', 'notification.send'].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of gotifyConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('gotify message.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /message/{messageId} with the client token in the query', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await gotifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'message.delete',
      args: { messageId: 42, client_token: 'client_tok' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/message/42')
    expect(String(requestUrl)).toContain('token=client_tok')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      gotifyConnector.executeMutation!({
        source: source(),
        capabilityName: 'message.delete',
        args: { messageId: 1, client_token: 'client_tok' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('gotify application.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /application with the new application name', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 7, token: 'A_NEW_APP_TOKEN' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await gotifyConnector.executeMutation!({
      source: source(),
      capabilityName: 'application.create',
      args: { name: 'My App', description: 'desc', client_token: 'client_tok' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('/application')
    expect(String(requestUrl)).toContain('token=client_tok')
    expect(requestBody).toMatchObject({ name: 'My App', description: 'desc' })
  })
})
