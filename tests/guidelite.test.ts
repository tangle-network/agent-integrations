import { afterEach, describe, expect, it, vi } from 'vitest'
import { guideliteConnector } from '../src/connectors/adapters/guidelite.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_guidelite_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'guidelite',
    label: 'guidelite test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'guidelite_secret' },
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

describe('guidelite adapter manifest', () => {
  it('classifies itself as the other category and exposes the guidelite kind', () => {
    expect(guideliteConnector.manifest.kind).toBe('guidelite')
    expect(guideliteConnector.manifest.category).toBe('other')
    expect(guideliteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares API-key auth matching the activepieces catalog entry', () => {
    const auth = guideliteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the sendAPrompt action, polling reads, plus the guide.* write-side mutations', () => {
    const names = guideliteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('assistant.sendPrompt')
    expect(names).toContain('leads.list.recent')
    expect(names).toContain('conversations.list.recent')
    expect(names).toContain('guide.create')
    expect(names).toContain('guide.update')
    expect(names).toContain('guide.delete')

    const mutations = guideliteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toContain('assistant.sendPrompt')
    expect(mutations).toContain('guide.create')
    expect(mutations).toContain('guide.update')
    expect(mutations).toContain('guide.delete')
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    for (const cap of guideliteConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('guidelite guide.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /assistants with the new guide payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'guide_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await guideliteConnector.executeMutation!({
      source: source(),
      capabilityName: 'guide.create',
      args: {
        name: 'My Guide',
        description: 'desc',
        systemPrompt: 'sys',
        knowledgeBaseIds: ['kb_1'],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.guidelite.ai/api/v1/assistants')
    expect(requestBody).toMatchObject({ name: 'My Guide', description: 'desc' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      guideliteConnector.executeMutation!({
        source: source(),
        capabilityName: 'guide.create',
        args: { name: 'X', description: '', systemPrompt: '', knowledgeBaseIds: [] },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('guidelite guide.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /assistants/{guideId} with the partial payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'guide_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await guideliteConnector.executeMutation!({
      source: source(),
      capabilityName: 'guide.update',
      args: {
        guideId: 'guide_1',
        name: 'Renamed',
        description: '',
        systemPrompt: '',
        knowledgeBaseIds: [],
      },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toBe('https://api.guidelite.ai/api/v1/assistants/guide_1')
    expect(requestBody).toMatchObject({ name: 'Renamed' })
  })
})

describe('guidelite guide.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /assistants/{guideId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await guideliteConnector.executeMutation!({
      source: source(),
      capabilityName: 'guide.delete',
      args: { guideId: 'guide_1' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.guidelite.ai/api/v1/assistants/guide_1')
  })
})
