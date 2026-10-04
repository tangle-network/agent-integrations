import { afterEach, describe, expect, it, vi } from 'vitest'
import { oauth1Authorization } from '../src/connectors/adapters/oauth1.js'
import { declarativeRestConnector } from '../src/connectors/adapters/declarative-rest.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

afterEach(() => vi.restoreAllMocks())

describe('paid-ad authentication transport', () => {
  it('matches the published X OAuth1 signature vector', () => {
    // Public, revoked example credentials and golden signature from the provider.
    // https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature
    const authorization = oauth1Authorization({
      method: 'POST',
      url: new URL('https://api.x.com/1.1/statuses/update.json?include_entities=true'),
      formBody: new URLSearchParams({ status: 'Hello Ladies + Gentlemen, a signed OAuth request!' }).toString(),
      credentials: {
        consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
        consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
      },
      nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      timestamp: '1318622958',
    })
    expect(authorization).toContain('oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D"')
    expect(authorization).not.toContain('consumerSecret')
  })

  it('keeps application credentials out of manifests and redacts raw and encoded echoes', async () => {
    const secret = 'private-app/+token'
    const connector = declarativeRestConnector({
      kind: 'app-token-fixture', displayName: 'App token', description: 'Authentication fixture',
      category: 'other', auth: { kind: 'api-key', hint: 'Test token' }, baseUrl: 'https://example.com',
      defaultConsistencyModel: 'cache',
      credentialHeaders: { 'Developer-Token': secret }, credentialsExpiredStatuses: [401],
      capabilities: [{ name: 'accounts.list', class: 'read', description: 'Read accounts',
        parameters: { type: 'object', properties: {} }, request: { method: 'GET', path: '/accounts' } }],
    })
    expect(JSON.stringify(connector.manifest)).not.toContain(secret)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      `denied ${secret} ${encodeURIComponent(secret)} private-user-token`, { status: 403 }))
    const source: ResolvedDataSource = {
      id: 'connection', projectId: 'project', publishedAgentId: null, kind: 'app-token-fixture',
      label: 'Ads', consistencyModel: 'cache', scopes: [], metadata: {}, status: 'active',
      credentials: { kind: 'oauth2', accessToken: 'private-user-token' },
    }
    await expect(connector.executeRead!({ source, capabilityName: 'accounts.list', args: {}, idempotencyKey: 'read' }))
      .rejects.toThrow('denied [REDACTED] [REDACTED] [REDACTED]')
    expect(fetch.mock.calls[0]![1]?.headers).toMatchObject({
      'Developer-Token': secret, authorization: 'Bearer private-user-token',
    })
  })
})
