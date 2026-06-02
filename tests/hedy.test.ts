import { afterEach, describe, expect, it, vi } from 'vitest'
import { hedyConnector } from '../src/connectors/adapters/hedy.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_hedy_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hedy',
    label: 'hedy test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'hedy_secret' },
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

describe('hedy adapter manifest', () => {
  it('classifies itself under the doc category and exposes the hedy kind', () => {
    expect(hedyConnector.manifest.kind).toBe('hedy')
    expect(hedyConnector.manifest.category).toBe('doc')
    expect(hedyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface (Hedy uses bearer token auth)', () => {
    const auth = hedyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
    expect(auth.hint).toContain('Hedy')
  })

  it('exposes topic, session, and context management capabilities', () => {
    const names = hedyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('topics.create')
    expect(names).toContain('topics.get')
    expect(names).toContain('topics.list')
    expect(names).toContain('topics.update')
    expect(names).toContain('topics.delete')
    expect(names).toContain('sessions.get')
    expect(names).toContain('sessions.list_by_topic')
    expect(names).toContain('context.create')
    expect(names).toContain('context.get')
    expect(names).toContain('context.update')
    expect(names).toContain('context.delete')
  })

  it('marks new write capabilities as native-idempotency externalEffect mutations', () => {
    const newMutations = ['topics.delete', 'context.update', 'context.delete']
    for (const name of newMutations) {
      const cap = hedyConnector.manifest.capabilities.find((c) => c.name === name)
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('classifies capabilities correctly by mutation and read types', () => {
    const createTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.create')
    if (!createTopic) throw new Error('topics.create capability missing')
    expect(createTopic.class).toBe('mutation')

    const getTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.get')
    if (!getTopic) throw new Error('topics.get capability missing')
    expect(getTopic.class).toBe('read')

    const updateTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.update')
    if (!updateTopic) throw new Error('topics.update capability missing')
    expect(updateTopic.class).toBe('mutation')
  })
})

describe('hedy topics.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/topics/{topicId} and returns committed', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'topics.delete',
      args: { topicId: 'top_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/topics/top_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      hedyConnector.executeMutation!({
        source: source(),
        capabilityName: 'topics.delete',
        args: { topicId: 'top_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('hedy context.update and context.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/context/{contextId} with body args', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body as string
      return jsonResponse({ id: 'ctx_1', title: 'Updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'context.update',
      args: { contextId: 'ctx_1', title: 'Updated', content: 'new body' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/context/ctx_1')
    expect(JSON.parse(requestBody ?? '{}')).toMatchObject({
      contextId: 'ctx_1',
      title: 'Updated',
      content: 'new body',
    })
    expect(result.status).toBe('committed')
  })

  it('DELETEs /v1/context/{contextId}', async () => {
    let requestMethod: string | undefined
    let requestUrl: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestMethod = init?.method
        requestUrl = String(input)
        return jsonResponse({ deleted: true })
      }),
    )

    const result = await hedyConnector.executeMutation!({
      source: source(),
      capabilityName: 'context.delete',
      args: { contextId: 'ctx_99' },
      idempotencyKey: 'k-2',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.hedy.ai/v1/context/ctx_99')
    expect(result.status).toBe('committed')
  })
})
