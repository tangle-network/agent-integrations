import { afterEach, describe, expect, it, vi } from 'vitest'
import { zapierConnector } from '../src/connectors/adapters/zapier.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_zapier_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'zapier',
    label: 'Drew Zapier',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'zap_test_key' },
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

describe('zapier adapter manifest', () => {
  it('exposes the zapier kind in the other category', () => {
    expect(zapierConnector.manifest.kind).toBe('zapier')
    expect(zapierConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (account-scoped bearer token)', () => {
    expect(zapierConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers catch-hook, Zaps management, and NLA actions surfaces', () => {
    const names = zapierConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['actions.execute', 'actions.list', 'triggers.catch', 'zaps.get', 'zaps.list'].sort(),
    )
  })

  it('declares actions.execute as a mutation with native-idempotency CAS', () => {
    const cap = zapierConnector.manifest.capabilities.find((c) => c.name === 'actions.execute')
    expect(cap?.class).toBe('mutation')
    if (cap?.class === 'mutation') {
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('zapier NLA actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('actions.list GETs /v1/exposed and returns the parsed payload', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedAuth: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      const headers = init?.headers as Record<string, string> | undefined
      capturedAuth = headers?.authorization ?? null
      return jsonResponse({
        results: [
          { id: 'act_1', description: 'Send Slack message', params: ['channel', 'text'] },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zapierConnector.executeRead!({
      source: source(),
      capabilityName: 'actions.list',
      args: {},
      idempotencyKey: 'k-list-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toBe('https://nla.zapier.com/api/v1/exposed')
    expect(capturedAuth).toBe('Bearer zap_test_key')
    expect(result.data).toMatchObject({
      results: [{ id: 'act_1', description: 'Send Slack message' }],
    })
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('actions.list surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('unauthorized', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      zapierConnector.executeRead!({
        source: source(),
        capabilityName: 'actions.list',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('actions.execute POSTs to /v1/exposed/{action_id}/execute with instructions body', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    let capturedAuth: string | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? 'GET'
      capturedBody = JSON.parse(init!.body as string)
      const headers = init?.headers as Record<string, string> | undefined
      capturedAuth = headers?.authorization ?? null
      return jsonResponse({
        status: 'success',
        action_used: 'Send Slack message',
        result: { ts: '1700000000.0001' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await zapierConnector.executeMutation!({
      source: source(),
      capabilityName: 'actions.execute',
      args: {
        action_id: 'act_42',
        instructions: 'Send a message to #general saying ship it',
      },
      idempotencyKey: 'k-exec-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://nla.zapier.com/api/v1/exposed/act_42/execute')
    expect(capturedAuth).toBe('Bearer zap_test_key')
    expect(capturedBody).toMatchObject({
      action_id: 'act_42',
      instructions: 'Send a message to #general saying ship it',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect(result.data).toMatchObject({ status: 'success' })
      expect(result.idempotentReplay).toBe(false)
      expect(typeof result.committedAt).toBe('number')
    }
  })

  it('actions.execute forwards preview_only when set', async () => {
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init!.body as string)
        return jsonResponse({ status: 'preview', params: { channel: '#general' } })
      }),
    )

    await zapierConnector.executeMutation!({
      source: source(),
      capabilityName: 'actions.execute',
      args: {
        action_id: 'act_42',
        instructions: 'Send a message to #general',
        preview_only: true,
      },
      idempotencyKey: 'k-prev-1',
    })
    expect(capturedBody).toMatchObject({ preview_only: true })
  })

  it('actions.execute rejects missing action_id (path interpolation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      zapierConnector.executeMutation!({
        source: source(),
        capabilityName: 'actions.execute',
        args: { instructions: 'do the thing' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/action_id/)
  })

  it('actions.execute surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('forbidden', {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    await expect(
      zapierConnector.executeMutation!({
        source: source(),
        capabilityName: 'actions.execute',
        args: { action_id: 'act_42', instructions: 'go' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
