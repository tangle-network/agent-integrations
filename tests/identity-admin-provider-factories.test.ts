import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  auth0Connector,
} from '../src/connectors/adapters/index.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function auth0Source(tenantDomain: string): ResolvedDataSource {
  return {
    id: 'source_auth0',
    projectId: 'project_1',
    publishedAgentId: null,
    kind: 'auth0',
    label: 'Auth0',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { tenantDomain },
    credentials: { kind: 'oauth2', accessToken: 'access-token' },
    status: 'active',
  }
}

describe('Auth0 tenant URL boundary', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('allows Auth0 tenant hosts and rejects lookalike credential-exfiltration hosts', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await expect(auth0Connector.test(
      auth0Source('https://acme.us.auth0.com'),
    )).resolves.toEqual({ ok: true })
    expect(requestUrl).toBe('https://acme.us.auth0.com/api/v2/stats/active-users')

    await expect(auth0Connector.test(
      auth0Source('https://acme.us.auth0.com.attacker.test'),
    )).resolves.toEqual({
      ok: false,
      reason: 'connection base URL is not an allowed provider endpoint',
    })
  })
})
