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
})
