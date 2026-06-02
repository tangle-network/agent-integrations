import { afterEach, describe, expect, it, vi } from 'vitest'
import { insightoAiConnector } from '../src/connectors/adapters/insighto-ai.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_insighto_ai_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'insighto-ai',
    label: 'insighto-ai test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'insighto_secret' },
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

describe('insighto-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the insighto-ai kind', () => {
    expect(insightoAiConnector.manifest.kind).toBe('insighto-ai')
    expect(insightoAiConnector.manifest.category).toBe('comms')
    expect(insightoAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = insightoAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Insighto/i)
  })

  it('covers text blob, contact, call, campaign, and assistant capability surface', () => {
    const names = insightoAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'assistants.create',
        'assistants.delete',
        'calls.create',
        'campaigns.cancel',
        'campaigns.create',
        'contacts.upsert',
        'textblobs.add',
      ].sort(),
    )
    const mutations = insightoAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'assistants.create',
        'assistants.delete',
        'calls.create',
        'campaigns.cancel',
        'campaigns.create',
        'contacts.upsert',
        'textblobs.add',
      ].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['assistants.create', 'assistants.delete', 'campaigns.cancel']
    for (const name of expected) {
      const cap = insightoAiConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('insighto-ai assistants.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/assistants with the assistant payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'asst_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.create',
      args: { name: 'Sales bot', provider: 'openai', model: 'gpt-4o' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/assistants')
    expect(requestBody).toMatchObject({ name: 'Sales bot', provider: 'openai', model: 'gpt-4o' })
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      insightoAiConnector.executeMutation!({
        source: source(),
        capabilityName: 'assistants.create',
        args: { name: 'broken' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('insighto-ai assistants.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /v1/assistants/{assistant_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.delete',
      args: { assistant_id: 'asst_99' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/assistants/asst_99')
  })
})

describe('insighto-ai campaigns.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/campaigns/{campaign_id}/cancel', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ cancelled: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await insightoAiConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.cancel',
      args: { campaign_id: 'camp_7' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe('https://api.insighto.ai/v1/campaigns/camp_7/cancel')
  })
})
