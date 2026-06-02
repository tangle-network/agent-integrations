import { afterEach, describe, expect, it, vi } from 'vitest'
import { devinConnector } from '../src/connectors/adapters/devin.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_devin_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'devin',
    label: 'Drew Devin',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: {
      kind: 'api-key',
      apiKey: 'devin_test_key',
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

describe('devin adapter manifest', () => {
  it('classifies itself as the other category and exposes the devin kind', () => {
    expect(devinConnector.manifest.kind).toBe('devin')
    expect(devinConnector.manifest.category).toBe('other')
    expect(devinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = devinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes session lifecycle + attachments capabilities', () => {
    const names = devinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'attachments.upload',
        'create.session',
        'get.session.details',
        'send.message',
        'sessions.list',
      ].sort(),
    )
    const reads = devinConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = devinConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.session.details', 'sessions.list'].sort())
    expect(mutations).toEqual(
      ['attachments.upload', 'create.session', 'send.message'].sort(),
    )
  })

  it('marks attachments.upload as native-idempotency with external effect', () => {
    const cap = devinConnector.manifest.capabilities.find(
      (c) => c.name === 'attachments.upload',
    )
    expect(cap).toBeDefined()
    expect(cap?.class).toBe('mutation')
    if (cap?.class === 'mutation') {
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('devin adapter execution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sessions.list issues GET /sessions with optional limit/status as query params', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedAuth: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        const headers = init?.headers as Record<string, string> | undefined
        capturedAuth = headers?.authorization ?? null
        return jsonResponse({ sessions: [{ session_id: 'devin-1', status: 'running' }] })
      }),
    )

    const result = await devinConnector.executeRead!({
      source: source(),
      capabilityName: 'sessions.list',
      args: { limit: 10, status: 'running' },
      idempotencyKey: 'k-list-1',
    })

    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('api.devin.ai')
    expect(capturedUrl).toContain('/sessions')
    expect(capturedUrl).toContain('limit=10')
    expect(capturedUrl).toContain('status=running')
    expect(capturedAuth).toBe('Bearer devin_test_key')
    const data = result.data as { sessions: Array<{ session_id: string }> }
    expect(data.sessions[0].session_id).toBe('devin-1')
    expect(typeof result.fetchedAt).toBe('number')
  })

  it('sessions.list omits absent filter params', async () => {
    let capturedUrl: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input)
        return jsonResponse({ sessions: [] })
      }),
    )

    await devinConnector.executeRead!({
      source: source(),
      capabilityName: 'sessions.list',
      args: {},
      idempotencyKey: 'k-list-2',
    })

    expect(capturedUrl).toContain('api.devin.ai')
    expect(capturedUrl).toContain('/sessions')
    expect(capturedUrl).not.toContain('limit=')
    expect(capturedUrl).not.toContain('status=')
  })

  it('sessions.list surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('unauthorized', {
            status: 401,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )

    await expect(
      devinConnector.executeRead!({
        source: source(),
        capabilityName: 'sessions.list',
        args: {},
        idempotencyKey: 'k-list-401',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('attachments.upload POSTs /attachments with session_id + content + filename', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | null = null
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? 'GET'
        capturedBody = JSON.parse((init?.body as string) ?? '{}')
        return jsonResponse({ attachment_id: 'att-1', filename: 'log.txt' })
      }),
    )

    const result = await devinConnector.executeMutation!({
      source: source(),
      capabilityName: 'attachments.upload',
      args: {
        session_id: 'devin-1',
        content: 'aGVsbG8=',
        encoding: 'base64',
        filename: 'log.txt',
        mime_type: 'text/plain',
      },
      idempotencyKey: 'idemp-attach-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toContain('api.devin.ai')
    expect(capturedUrl).toContain('/attachments')
    expect(capturedBody).toMatchObject({
      session_id: 'devin-1',
      content: 'aGVsbG8=',
      encoding: 'base64',
      filename: 'log.txt',
      mime_type: 'text/plain',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      const data = result.data as { attachment_id: string }
      expect(data.attachment_id).toBe('att-1')
      expect(typeof result.committedAt).toBe('number')
      expect(result.idempotentReplay).toBe(false)
    }
  })

  it('attachments.upload rejects when session_id is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      devinConnector.executeMutation!({
        source: source(),
        capabilityName: 'attachments.upload',
        args: { content: 'hi', filename: 'log.txt' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/session_id/)
  })

  it('attachments.upload rejects when content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      devinConnector.executeMutation!({
        source: source(),
        capabilityName: 'attachments.upload',
        args: { session_id: 'devin-1', filename: 'log.txt' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/content/)
  })

  it('attachments.upload rejects when filename is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      devinConnector.executeMutation!({
        source: source(),
        capabilityName: 'attachments.upload',
        args: { session_id: 'devin-1', content: 'hi' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/filename/)
  })

  it('attachments.upload surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
          }),
      ),
    )
    await expect(
      devinConnector.executeMutation!({
        source: source(),
        capabilityName: 'attachments.upload',
        args: {
          session_id: 'devin-1',
          content: 'hi',
          encoding: 'utf-8',
          filename: 'log.txt',
          mime_type: 'text/plain',
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
