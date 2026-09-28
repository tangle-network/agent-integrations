import { afterEach, describe, expect, it, vi } from 'vitest'
import { heymarketSmsConnector } from '../src/connectors/adapters/heymarket-sms.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_heymarket_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'heymarket-sms',
    label: 'heymarket test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'heymarket_secret' },
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

describe('heymarket-sms contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v3/contacts/{contact_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({ deleted: true })
      }),
    )

    const result = await heymarketSmsConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { contact_id: 'ct_42' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.heymarket.com/v3/contacts/ct_42')
    expect(result.status).toBe('committed')
  })
})
