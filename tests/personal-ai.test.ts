import { afterEach, describe, expect, it, vi } from 'vitest'
import { personalAiConnector } from '../src/connectors/adapters/personal-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_personal_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'personal-ai',
    label: 'personal-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'personal_ai_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const NEW_MUTATIONS = ['memory.delete', 'document.delete', 'training.delete', 'persona.update']

describe('personal-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the personal-ai kind', () => {
    expect(personalAiConnector.manifest.kind).toBe('personal-ai')
    expect(personalAiConnector.manifest.category).toBe('other')
    expect(personalAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = personalAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Personal AI/i)
  })

  it('covers memory, message, conversation, training, document, and persona surface', () => {
    const names = personalAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'memory.create',
        'memory.delete',
        'message.create',
        'conversation.get',
        'training.create',
        'training.delete',
        'document.get',
        'document.upload',
        'document.update',
        'document.delete',
        'persona.update',
      ].sort(),
    )
    const mutations = personalAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'memory.create',
        'memory.delete',
        'message.create',
        'training.create',
        'training.delete',
        'document.upload',
        'document.update',
        'document.delete',
        'persona.update',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect=true', () => {
    for (const name of NEW_MUTATIONS) {
      const cap = personalAiConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('personal-ai memory.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/memory/{memoryId} with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = new Headers(init?.headers ?? {})
      authHeader = headers.get('authorization') ?? undefined
      return jsonResponse(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await personalAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'memory.delete',
      args: { memoryId: 'mem_1' },
      idempotencyKey: 'k-mem-del',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.personal-ai.com/v1/memory/mem_1')
    expect(authHeader).toBe('Bearer personal_ai_secret')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      personalAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'memory.delete',
        args: { memoryId: 'mem_1' },
        idempotencyKey: 'k-mem-del',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('personal-ai document.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/documents/{documentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await personalAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'document.delete',
      args: { documentId: 'doc_99' },
      idempotencyKey: 'k-doc-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.personal-ai.com/v1/documents/doc_99')
  })
})

describe('personal-ai training.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/training/{trainingId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await personalAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'training.delete',
      args: { trainingId: 'train_5' },
      idempotencyKey: 'k-train-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.personal-ai.com/v1/training/train_5')
  })
})

describe('personal-ai persona.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/persona with the args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
      return jsonResponse({ displayName: 'New Name' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await personalAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'persona.update',
      args: { displayName: 'New Name', tone: 'casual' },
      idempotencyKey: 'k-persona',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.personal-ai.com/v1/persona')
    expect(requestBody).toMatchObject({ displayName: 'New Name', tone: 'casual' })
  })
})
