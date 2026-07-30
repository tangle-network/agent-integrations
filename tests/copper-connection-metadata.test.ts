import { afterEach, describe, expect, it, vi } from 'vitest'
import { copperConnector } from '../src/connectors/adapters/copper.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

afterEach(() => vi.unstubAllGlobals())

describe('Copper connection metadata headers', () => {
  it('sends the API-key owner email on every provider request', async () => {
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(copperConnector.test(source())).resolves.toEqual({ ok: true })
    expect(requestHeaders['X-PW-AccessToken']).toBe('copper-api-key')
    expect(requestHeaders['x-pw-application']).toBe('developer_api')
    expect(requestHeaders['x-pw-useremail']).toBe('owner@tangle.tools')
  })

  it('fails before the network call when the key-owner email is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(copperConnector.test(source({ metadata: {} }))).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining('connection.userEmail'),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'source_copper',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'copper',
    label: 'Copper',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { userEmail: 'owner@tangle.tools' },
    credentials: { kind: 'api-key', apiKey: 'copper-api-key' },
    status: 'active',
    ...overrides,
  }
}
