import { createServer } from 'node:http'
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IntegrationError } from '../src/core-error.js'
import { IntegrationHub } from '../src/hub.js'
import { createCredentialBackedAdapterProvider } from '../src/credentials.js'
import { zendeskConnector } from '../src/connectors/adapters/zendesk.js'
import { zendeskSellConnector } from '../src/connectors/adapters/zendesk-sell.js'
import { cloudbedsConnector } from '../src/connectors/adapters/cloudbeds.js'
import { pricelabsConnector } from '../src/connectors/adapters/pricelabs.js'
import { whatsappConnector } from '../src/connectors/adapters/whatsapp.js'
import { reddit } from '../src/connectors/adapters/reddit.js'
import { twitter } from '../src/connectors/adapters/twitter.js'
import { listBundledConnectorAdapters } from '../src/connectors/bundled-manifest-runtime.js'
import type { ConnectorAdapter, ConnectorCredentials } from '../src/connectors/types.js'
import type { IntegrationConnection, IntegrationConnectionStore, IntegrationSecretStore, IntegrationOAuthState } from '../src/core-types.js'

// The maintained adapters, Hub, SQL, AES-GCM vault and HTTP serialization all
// run here. Route only the provider's network boundary to a loopback server.
describe('connector host over HTTP and encrypted SQL persistence', () => {
  const realFetch = globalThis.fetch
  const owner = { type: 'user' as const, id: 'host-owner' }
  const client = { clientId: 'client id:✓', clientSecret: 's e+c%r:et' }
  const redirectUri = 'https://platform.example.test/callback'
  let db: DatabaseSync
  let connections: IntegrationConnectionStore
  let secrets: IntegrationSecretStore
  let close: () => Promise<void>
  let releaseSlow: () => void
  let slowFinished: Promise<void>
  let wire: Array<{ host: string; path: string; auth: string; body: URLSearchParams }>

  beforeEach(async () => {
    wire = []
    db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE connections (id TEXT PRIMARY KEY, record TEXT); CREATE TABLE secrets (id TEXT PRIMARY KEY, payload BLOB); CREATE TABLE states (id TEXT PRIMARY KEY, record TEXT)')
    const key = randomBytes(32)
    connections = {
      get: id => { const row = db.prepare('SELECT record FROM connections WHERE id=?').get(id); return row ? JSON.parse(String(row.record)) : undefined },
      put: connection => { db.prepare('INSERT OR REPLACE INTO connections VALUES (?,?)').run(connection.id, JSON.stringify(connection)) },
      listByOwner: actor => db.prepare('SELECT record FROM connections').all().map(row => JSON.parse(String(row.record)) as IntegrationConnection)
        .filter(connection => connection.owner.id === actor.id && connection.owner.type === actor.type),
    }
    secrets = {
      put(ref, credentials) {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()])
        db.prepare('INSERT OR REPLACE INTO secrets VALUES (?,?)').run(ref.id, Buffer.concat([iv, cipher.getAuthTag(), encrypted]))
      },
      get(ref) {
        const row = db.prepare('SELECT payload FROM secrets WHERE id=?').get(ref.id)
        if (!row) return undefined
        const payload = Buffer.from(row.payload as Uint8Array)
        const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
        decipher.setAuthTag(payload.subarray(12, 28))
        return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString())
      },
    }
    let finishSlow: () => void
    slowFinished = new Promise(resolve => { finishSlow = resolve })
    const slow = new Promise<void>(resolve => { releaseSlow = resolve })
    const server = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = new URLSearchParams(raw)
      wire.push({ host: String(request.headers['x-provider-host']), path: request.url!, auth: String(request.headers.authorization ?? ''), body })
      if (body.get('code') === 'slow') await slow
      response.setHeader('content-type', 'application/json')
      if (body.get('code') === 'reflect-secret') {
        response.statusCode = 400
        response.end(JSON.stringify({ error: client.clientSecret, encoded: encodeURIComponent(client.clientSecret) }))
      } else if (request.headers.authorization === 'Bearer revoked') {
        response.statusCode = 401
        response.end('{}')
      } else if (request.headers.authorization === 'Bearer limited') {
        response.statusCode = 429
        response.end('{}')
      } else if (request.headers['x-provider-host'] === 'oauth.reddit.com') {
        response.statusCode = 503
        response.end('{}')
      } else if (request.method === 'POST') {
        response.end(JSON.stringify({ access_token: 'issued-access', refresh_token: 'issued-refresh', expires_in: 3600 }))
      } else response.end(JSON.stringify({ user: { id: 42 }, data: [] }))
      if (body.get('code') === 'slow') finishSlow!()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    globalThis.fetch = (input, init) => {
      const url = new URL(String(input))
      if (!['tenant.zendesk.com', 'api.twitter.com', 'api.x.com', 'api.sellsy.com', 'www.reddit.com', 'oauth.reddit.com'].includes(url.hostname)) throw new Error('External network forbidden')
      const headers = new Headers(init?.headers)
      headers.set('x-provider-host', url.hostname)
      return realFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, { ...init, headers })
    }
    close = () => new Promise<void>((resolve, reject) => {
      releaseSlow()
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    await close()
    db.close()
  })

  function host(adapters: ConnectorAdapter[], timeoutMs = 1000, configId?: string, refuseScope = false) {
    const provider = createCredentialBackedAdapterProvider({
      id: 'first-party', adapters, secrets, connections, operationTimeoutMs: timeoutMs,
      resolveOAuthClient: () => ({ ...client, configId }),
      async persistConnection({ connection, credentials }) {
        if (refuseScope) throw new IntegrationError(client.clientSecret, 'credential_scope_invalid')
        // A reconnect preserves the account's canonical id and replaces its
        // encrypted credential, rather than returning the provider's random id.
        const id = `canonical-${connection.owner.id}-${connection.connectorId}`
        const secretRef = { provider: 'sql-vault', id }
        const canonical = { ...connection, id, secretRef }
        db.exec('BEGIN IMMEDIATE')
        try { await secrets.put(secretRef, credentials); await connections.put(canonical); db.exec('COMMIT') }
        catch (error) { db.exec('ROLLBACK'); throw error }
        return canonical
      },
    })
    const hub = new IntegrationHub({ providers: [provider], store: connections, secretStore: secrets, capabilitySecret: 'protocol-fixture-secret',
      oauthStateStore: {
        put(state) { db.prepare('INSERT INTO states VALUES (?,?)').run(state.state, JSON.stringify(state)) },
        consume(state) {
          const row = db.prepare('DELETE FROM states WHERE id=? RETURNING record').get(state)
          if (!row) return { ok: false as const, reason: 'unknown' as const }
          const record = JSON.parse(String(row.record)) as IntegrationOAuthState
          return record.expiresAt > Date.now() ? { ok: true as const, state: record } : { ok: false as const, reason: 'expired' as const }
        },
      },
    })
    return { hub, provider }
  }

  it('binds reserved parameters, normalized tenant and PKCE through exchange, encrypted commit, reconnect and probe', async () => {
    const auth = zendeskConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('Expected OAuth connector')
    const adapter = { ...zendeskConnector, manifest: { ...zendeskConnector.manifest, auth: { ...auth, extraAuthParams: {
      state: 'attacker', redirect_uri: 'https://attacker.test', client_id: 'attacker', scope: 'admin', config_id: 'attacker', code_challenge: 'attacker', prompt: 'consent',
    } } } }
    const { hub } = host([adapter])
    const start = () => hub.startAuth('first-party', { connectorId: 'zendesk', owner, requestedScopes: ['read'], redirectUri, metadata: { subdomain: ' TENANT ' } })
    const started = await start()
    const url = new URL(started.authUrl)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ state: started.state, redirect_uri: redirectUri, client_id: client.clientId, scope: 'read', prompt: 'consent', code_challenge_method: 'S256' })
    expect(url.searchParams.has('config_id')).toBe(false)
    const complete = (state: string) => hub.completeAuth('first-party', { connectorId: 'zendesk', owner, code: 'one-time', state, redirectUri,
      metadata: { subdomain: 'attacker', subdomainUrl: 'https://attacker.test' } })
    const connection = await complete(started.state)
    expect(connection.id).toBe('canonical-host-owner-zendesk')
    expect(connection.metadata).toMatchObject({ subdomain: 'tenant', subdomainUrl: 'https://tenant.zendesk.com/' })
    const verifier = wire[0].body.get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(wire[0].host).toBe('tenant.zendesk.com')
    expect(wire[0].body.get('client_secret')).toBe(client.clientSecret)
    expect(await secrets.get(connection.secretRef!)).toMatchObject({ accessToken: 'issued-access', refreshToken: 'issued-refresh' })
    expect(String(db.prepare('SELECT record FROM connections').get()!.record)).not.toContain('issued-access')
    expect(Buffer.from(db.prepare('SELECT payload FROM secrets').get()!.payload as Uint8Array).includes(Buffer.from('issued-access'))).toBe(false)
    await expect(complete(started.state)).rejects.toMatchObject({ code: 'capability_invalid' })
    const again = await start()
    expect((await complete(again.state)).id).toBe(connection.id)
    expect(await hub.testConnection(connection.id)).toBe('healthy')
    expect(wire.at(-1)!.auth).toBe('Bearer issued-access')
    const configured = host([adapter], 1000, 'business-config')
    const business = await configured.hub.startAuth('first-party', { connectorId: 'zendesk', owner, requestedScopes: ['read'], redirectUri, metadata: { subdomain: 'tenant' } })
    expect(new URL(business.authUrl).searchParams.get('config_id')).toBe('business-config')
    expect(new URL(business.authUrl).searchParams.has('scope')).toBe(false)
  })

  it('uses the maintained adapter-owned Basic exchange and fences late credentials after its deadline', async () => {
    const adapter = twitter(client)
    const { hub } = host([adapter])
    const begin = () => hub.startAuth('first-party', { connectorId: 'twitter', owner, requestedScopes: [], redirectUri })
    const started = await begin()
    const connected = await hub.completeAuth('first-party', { connectorId: 'twitter', owner, code: 'one-time', state: started.state, redirectUri })
    expect(wire[0].path).toContain('/oauth2/token')
    expect(wire[0].auth).toBe(`Basic ${Buffer.from('client+id%3A%E2%9C%93:s+e%2Bc%25r%3Aet').toString('base64')}`)
    expect(wire[0].body.has('client_secret')).toBe(false)
    expect(connected.id).toBe('canonical-host-owner-twitter')
    let observedSlow: () => void
    const completedSlow = new Promise<void>(resolve => { observedSlow = resolve })
    const delayed = host([{ ...adapter, exchangeOAuth: input => adapter.exchangeOAuth!(input).finally(() => observedSlow!()) }], 30)
    const pending = await delayed.hub.startAuth('first-party', { connectorId: 'twitter', owner, requestedScopes: [], redirectUri })
    await expect(delayed.hub.completeAuth('first-party', { connectorId: 'twitter', owner, code: 'slow', state: pending.state, redirectUri })).rejects.toThrow(/timed out/)
    const before = db.prepare('SELECT payload FROM secrets').get()!.payload
    releaseSlow()
    await slowFinished
    await completedSlow
    // Completing the old provider request cannot commit its late result.
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(db.prepare('SELECT payload FROM secrets').get()!.payload).toEqual(before)
  })

  it('validates API keys through real HTTP and exposes probe failures without persisting rejected keys', async () => {
    const { hub } = host([zendeskSellConnector, cloudbedsConnector, pricelabsConnector, whatsappConnector])
    for (const connectorId of ['cloudbeds', 'pricelabs', 'whatsapp']) {
      await expect(hub.connectApiKey('first-party', { connectorId, owner, apiKey: 'valid-key', metadata: { apiUrl: 'https://attacker.test' } })).rejects.toMatchObject({ code: 'connection_metadata_invalid' })
    }
    const connect = (apiKey: string) => hub.connectApiKey('first-party', { connectorId: 'zendesk-sell', owner, apiKey })
    await expect(connect('revoked')).rejects.toMatchObject({ code: 'credential_invalid' })
    await expect(connect('limited')).rejects.toMatchObject({ code: 'credential_rate_limited' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM secrets').get()!.n).toBe(0)
    const active = await connect('valid-key')
    expect(active.secretRef!.id).toBe(active.id)
    expect(wire.at(-1)!.auth).toBe('Bearer valid-key')
    const scoped = host([zendeskSellConnector], 1000, undefined, true)
    const refused = scoped.hub.connectApiKey('first-party', { connectorId: 'zendesk-sell', owner, apiKey: 'valid-key' })
    await expect(refused).rejects.toMatchObject({ code: 'credential_scope_invalid', message: 'Credential commit rejected.' })
    await expect(refused).rejects.not.toThrow(client.clientSecret)
  })

  it('persists a real refresh when the following HTTP probe rejects', async () => {
    const adapter = reddit(client)
    const test = adapter.test.bind(adapter)
    // Exercise the public rejected-promise failure contract with the same
    // maintained HTTP probe and refresh; no simulated token response.
    adapter.test = async (source, onRotated) => {
      const result = await test(source, onRotated)
      if (!result.ok) throw new Error(result.reason)
      return result
    }
    const { hub } = host([adapter])
    const issued = new Date().toISOString()
    const secretRef = { provider: 'sql-vault', id: 'refresh-then-fail' }
    const connection: IntegrationConnection = { id: secretRef.id, owner, connectorId: 'reddit', providerId: 'first-party',
      status: 'active', grantedScopes: [], secretRef, createdAt: issued, updatedAt: issued }
    await secrets.put(secretRef, { kind: 'oauth2', accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() + 30_000 })
    await connections.put(connection)
    expect(await hub.testConnection(connection.id)).toBe('provider_failure')
    expect(wire.map(request => request.host)).toEqual(['www.reddit.com', 'oauth.reddit.com'])
    expect(wire[0].body.get('refresh_token')).toBe('old-refresh')
    expect(wire[1].auth).toBe('Bearer issued-access')
    expect(await secrets.get(secretRef)).toMatchObject({ accessToken: 'issued-access', refreshToken: 'issued-refresh' })
  })

  it('redacts provider reflections and refuses private endpoints or bad tenants before provider traffic', async () => {
    const { hub } = host([zendeskConnector])
    const start = (subdomain: string) => hub.startAuth('first-party', { connectorId: 'zendesk', owner, requestedScopes: [], redirectUri, metadata: { subdomain } })
    await expect(start('tenant.attacker.test')).rejects.toMatchObject({ code: 'connection_parameters_invalid' })
    await expect(hub.startAuth('first-party', { connectorId: 'zendesk', owner, requestedScopes: [], redirectUri })).rejects.toMatchObject({ code: 'connection_parameters_missing' })
    expect(wire).toHaveLength(0)
    const started = await start('tenant')
    const result = hub.completeAuth('first-party', { connectorId: 'zendesk', owner, code: 'reflect-secret', state: started.state, redirectUri })
    await expect(result).rejects.toMatchObject({ code: 'provider_failure' })
    await expect(result).rejects.not.toThrow(client.clientSecret)
    await expect(result).rejects.not.toThrow(encodeURIComponent(client.clientSecret))
    const auth = zendeskConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('Expected OAuth connector')
    const privateHost = host([{ ...zendeskConnector, manifest: { ...zendeskConnector.manifest, auth: { ...auth, tokenUrl: 'https://127.0.0.1/token' } } }])
    const pending = await privateHost.hub.startAuth('first-party', { connectorId: 'zendesk', owner, requestedScopes: [], redirectUri, metadata: { subdomain: 'tenant' } })
    await expect(privateHost.hub.completeAuth('first-party', { connectorId: 'zendesk', owner, code: 'one-time', state: pending.state, redirectUri })).rejects.toMatchObject({ code: 'config_missing' })
    expect(wire).toHaveLength(1)
  })

  it('keeps catalog-only factories visible but refuses execution and prefers configured factories', async () => {
    const catalog = listBundledConnectorAdapters({ includeUnconfigured: true })
    const configured = listBundledConnectorAdapters({ envSource: { GOOGLE_OAUTH_CLIENT_ID: client.clientId, GOOGLE_OAUTH_CLIENT_SECRET: client.clientSecret }, includeUnconfigured: true })
    expect(catalog.find(adapter => adapter.manifest.kind === 'google-calendar')!.catalogOnly).toBe(true)
    expect(configured.find(adapter => adapter.manifest.kind === 'google-calendar')!.catalogOnly).toBe(false)
    const { hub, provider } = host(catalog)
    await expect(hub.startAuth('first-party', { connectorId: 'google-calendar', owner, requestedScopes: [], redirectUri })).rejects.toMatchObject({ code: 'config_missing' })
    const issued = new Date().toISOString()
    const connection: IntegrationConnection = { id: 'catalog-connection', owner, connectorId: 'google-calendar', providerId: 'first-party',
      status: 'active', grantedScopes: [], createdAt: issued, updatedAt: issued }
    await connections.put(connection)
    const action = catalog.find(adapter => adapter.manifest.kind === 'google-calendar')!.manifest.capabilities[0].name
    await expect(provider.invokeAction(connection, { connectionId: connection.id, action })).rejects.toMatchObject({ code: 'config_missing' })
    expect(wire).toHaveLength(0)
  })
})
