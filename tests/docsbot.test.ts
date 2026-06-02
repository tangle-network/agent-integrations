import { afterEach, describe, expect, it, vi } from 'vitest'
import { docsbotConnector } from '../src/connectors/adapters/docsbot.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_docsbot_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'docsbot',
    label: 'docsbot test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'docsbot_secret' },
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

describe('docsbot adapter manifest', () => {
  it('classifies itself as the other category and exposes the docsbot kind', () => {
    expect(docsbotConnector.manifest.kind).toBe('docsbot')
    expect(docsbotConnector.manifest.category).toBe('other')
    expect(docsbotConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = docsbotConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus sources.delete', () => {
    const names = docsbotConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'bots.find',
        'bots.create',
        'sources.create',
        'sources.upload',
        'sources.delete',
        'conversations.ask',
      ].sort(),
    )
    const reads = docsbotConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = docsbotConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['bots.find', 'conversations.ask'].sort())
    expect(mutations).toEqual(
      ['bots.create', 'sources.create', 'sources.upload', 'sources.delete'].sort(),
    )
  })

  it('marks new write-side mutations as native-idempotency + externalEffect=true', () => {
    const expected = ['sources.delete']
    for (const name of expected) {
      const cap = docsbotConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('docsbot sources.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /api/v1/bots/{botId}/sources/{sourceId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await docsbotConnector.executeMutation!({
      source: source(),
      capabilityName: 'sources.delete',
      args: { botId: 'bot_1', sourceId: 'src_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.docsbot.ai/api/v1/bots/bot_1/sources/src_42')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      docsbotConnector.executeMutation!({
        source: source(),
        capabilityName: 'sources.delete',
        args: { botId: 'bot_1', sourceId: 'src_42' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
