import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boxConnector,
  salesforceConnector,
  stripeConnector,
  type ResolvedDataSource,
} from '../src/connectors/index'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('declarative provider credential redaction', () => {
  it('redacts OAuth access and refresh tokens from provider failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(
      'upstream echoed sf-access and sf-refresh',
      500,
    )))

    const failure = await salesforceConnector.executeRead!({
      source: oauthSource('salesforce', 'sf-access', 'sf-refresh', {
        instanceUrl: 'https://example.my.salesforce.com',
      }),
      capabilityName: 'records.query',
      args: { q: 'SELECT Id FROM Account' },
      idempotencyKey: 'read-salesforce',
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).not.toContain('sf-access')
    expect(String(failure)).not.toContain('sf-refresh')
    expect(String(failure)).toContain('[REDACTED]')
  })

  it('redacts OAuth credentials from conflict result bodies and messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(
      JSON.stringify({ message: 'conflict for box-access' }),
      409,
      { 'content-type': 'application/json' },
    )))

    const result = await boxConnector.executeMutation!({
      source: oauthSource('box', 'box-access', 'box-refresh'),
      capabilityName: 'folders.create',
      args: { name: 'Reports', parent: { id: '0' } },
      idempotencyKey: 'folder-reports',
    })

    expect(JSON.stringify(result)).not.toContain('box-access')
    expect(JSON.stringify(result)).toContain('[REDACTED]')
  })

  it('redacts API keys from throttling details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(
      JSON.stringify({ error: 'rate limit for sk_test_sensitive' }),
      429,
      { 'content-type': 'application/json', 'retry-after': '1' },
    )))

    const failure = await stripeConnector.executeRead!({
      source: apiKeySource('stripe', 'sk_test_sensitive'),
      capabilityName: 'customers.search',
      args: { limit: 10 },
      idempotencyKey: 'read-stripe',
    }).catch((error: unknown) => error)

    expect(JSON.stringify(failure)).not.toContain('sk_test_sensitive')
    expect(JSON.stringify(failure)).toContain('[REDACTED]')
  })
})

function oauthSource(
  kind: string,
  accessToken: string,
  refreshToken: string,
  metadata: Record<string, unknown> = {},
): ResolvedDataSource {
  return {
    id: `source_${kind}`,
    projectId: 'project_1',
    publishedAgentId: null,
    kind,
    label: kind,
    consistencyModel: 'authoritative',
    scopes: [],
    metadata,
    credentials: { kind: 'oauth2', accessToken, refreshToken },
    status: 'active',
  }
}

function apiKeySource(kind: string, apiKey: string): ResolvedDataSource {
  return {
    ...oauthSource(kind, '', ''),
    credentials: { kind: 'api-key', apiKey },
  }
}

function response(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers })
}
