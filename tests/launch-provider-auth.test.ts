import { describe, expect, it, vi } from 'vitest'
import { createConnectorAdapterProvider } from '../src/index'
import {
  dropboxConnector,
  salesforceConnector,
} from '../src/connectors/adapters/index'

describe('launch provider OAuth contracts', () => {
  it('captures the Salesforce tenant URL returned by the token exchange', () => {
    const auth = salesforceConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') return
    expect(auth.tokenMetadata).toEqual({
      instanceUrl: { field: 'instance_url', required: true },
    })
  })

  it('persists the Salesforce tenant URL during a real token exchange', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'salesforce-access',
      refresh_token: 'salesforce-refresh',
      instance_url: 'https://acme.my.salesforce.com',
      scope: 'api refresh_token',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const provider = createConnectorAdapterProvider({
      adapters: [salesforceConnector],
      resolveDataSource: () => ({}) as never,
      resolveOAuthClient: () => ({
        clientId: 'salesforce-client',
        clientSecret: 'salesforce-secret',
      }),
      fetchImpl,
    })

    const connection = await provider.completeAuth!({
      connectorId: 'salesforce',
      owner: { type: 'user', id: 'user_1' },
      code: 'authorization-code',
      state: 'salesforce-state',
      redirectUri: 'https://id.tangle.tools/api/integrations/callback',
      codeVerifier: 'v'.repeat(64),
    })

    expect(connection.metadata).toEqual({
      instanceUrl: 'https://acme.my.salesforce.com',
    })
  })

  it('requests a durable Dropbox refresh token', () => {
    const auth = dropboxConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') return
    expect(auth.extraAuthParams).toEqual({ token_access_type: 'offline' })
  })

  it('adds offline access to the Dropbox authorization URL', async () => {
    const provider = createConnectorAdapterProvider({
      adapters: [dropboxConnector],
      resolveDataSource: () => ({}) as never,
      resolveOAuthClient: () => ({
        clientId: 'dropbox-client',
        clientSecret: 'dropbox-secret',
      }),
    })

    const result = await provider.startAuth!({
      connectorId: 'dropbox',
      owner: { type: 'user', id: 'user_1' },
      requestedScopes: [],
      redirectUri: 'https://id.tangle.tools/api/integrations/callback',
      codeChallenge: 'c'.repeat(43),
    })

    const authorizationUrl = new URL(result.authUrl)
    expect(authorizationUrl.searchParams.get('token_access_type')).toBe('offline')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('dropbox-client')
  })
})
