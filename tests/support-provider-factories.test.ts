import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  freshdeskConnector,
  gorgiasConnector,
  zendeskConnector,
} from '../src/connectors/adapters/index.js'
import type { ConnectorAdapter, ResolvedDataSource } from '../src/connectors/types.js'

function source(kind: string, subdomainUrl: string): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { subdomainUrl },
    credentials: { kind: 'oauth2', accessToken: 'access-token' },
    status: 'active',
  }
}

describe('support tenant URL boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    [zendeskConnector, 'zendesk', 'https://acme.zendesk.com', 'https://acme.zendesk.com/api/v2/users/me.json'],
    [freshdeskConnector, 'freshdesk', 'https://acme.freshdesk.com', 'https://acme.freshdesk.com/api/v2/agents/me'],
    [gorgiasConnector, 'gorgias', 'https://acme.gorgias.com', 'https://acme.gorgias.com/api/users/0'],
  ] as const)('allows %s tenant hosts and blocks lookalike hosts', async (adapter: ConnectorAdapter, kind, baseUrl, expectedUrl) => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await expect(adapter.test(source(kind, baseUrl))).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe(expectedUrl)

    await expect(adapter.test(source(kind, `${baseUrl}.attacker.test`))).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
  })
})
