import { describe, expect, it } from 'vitest'
import { freshdeskConnector } from '../src/connectors/adapters/freshdesk.js'

describe('freshdesk adapter manifest', () => {
  it('classifies itself as the crm category and exposes the freshdesk kind', () => {
    expect(freshdeskConnector.manifest.kind).toBe('freshdesk')
    expect(freshdeskConnector.manifest.category).toBe('crm')
    expect(freshdeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the per-subdomain Freshdesk endpoints and env-var names', () => {
    const auth = freshdeskConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://{subdomain}.freshdesk.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://{subdomain}.freshdesk.com/oauth/token')
    expect(auth.clientIdEnv).toBe('FRESHDESK_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('FRESHDESK_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('freshdesk.api')
  })

  it('covers the ticket + contact action pack', () => {
    const names = freshdeskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tickets.search',
        'tickets.list',
        'tickets.get',
        'tickets.create',
        'tickets.update',
        'tickets.reply',
        'tickets.note',
        'contacts.search',
        'contacts.create',
      ].sort(),
    )

    const reads = freshdeskConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = freshdeskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['contacts.search', 'tickets.get', 'tickets.list', 'tickets.search'])
    expect(mutations).toEqual(
      ['contacts.create', 'tickets.create', 'tickets.note', 'tickets.reply', 'tickets.update'].sort(),
    )
  })

  it('routes the ticket update via PUT with optimistic-read-verify CAS', () => {
    const update = freshdeskConnector.manifest.capabilities.find((c) => c.name === 'tickets.update')
    expect(update).toBeDefined()
    if (!update || update.class !== 'mutation') throw new Error('unreachable')
    expect(update.cas).toBe('optimistic-read-verify')
  })

  it('every capability requires the freshdesk.api scope', () => {
    for (const cap of freshdeskConnector.manifest.capabilities) {
      expect(cap.requiredScopes).toContain('freshdesk.api')
    }
  })
})
