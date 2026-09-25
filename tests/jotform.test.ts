import { afterEach, describe, expect, it, vi } from 'vitest'
import { jotformConnector } from '../src/connectors/adapters/jotform.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

describe('jotform regional routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('pins EU accounts to the connection host instead of an action argument', async () => {
    const source: ResolvedDataSource = {
      id: 'src_jotform_eu',
      projectId: 'proj_1',
      publishedAgentId: null,
      kind: 'jotform',
      label: 'Jotform EU',
      consistencyModel: 'authoritative',
      scopes: [],
      metadata: { apiBaseUrl: 'https://eu-api.jotform.com' },
      credentials: { kind: 'api-key', apiKey: 'jotform_test_key' },
      status: 'active',
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await jotformConnector.executeRead!({
      source,
      capabilityName: 'forms.list',
      args: { apiBaseUrl: 'https://attacker.example' },
      idempotencyKey: 'read-1',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(new URL(url).origin).toBe('https://eu-api.jotform.com')
  })

  it('rejects untrusted connection hosts before sending the API key', async () => {
    const source: ResolvedDataSource = {
      id: 'src_jotform_untrusted',
      projectId: 'proj_1',
      publishedAgentId: null,
      kind: 'jotform',
      label: 'Jotform untrusted',
      consistencyModel: 'authoritative',
      scopes: [],
      metadata: { apiBaseUrl: 'https://credential-capture.example' },
      credentials: { kind: 'api-key', apiKey: 'must_not_leave_process' },
      status: 'active',
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(jotformConnector.executeRead!({
      source,
      capabilityName: 'forms.list',
      args: {},
      idempotencyKey: 'read-2',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
