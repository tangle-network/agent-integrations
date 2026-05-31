import { describe, expect, it } from 'vitest'
import { googlechatConnector } from '../src/connectors/adapters/googlechat.js'

describe('googlechat adapter manifest', () => {
  it('classifies itself as the comms category and exposes the googlechat kind', () => {
    expect(googlechatConnector.manifest.kind).toBe('googlechat')
    expect(googlechatConnector.manifest.category).toBe('comms')
    expect(googlechatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Google endpoints and env-var names', () => {
    const auth = googlechatConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.messages')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.spaces')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.memberships')
  })

  it('covers the full activepieces action set (send + read message details + add member + search + find member)', () => {
    const names = googlechatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'send.amessage',
        'get.direct.message.details',
        'add.aspace.member',
        'get.message.details',
        'search.messages',
        'find.member',
      ].sort(),
    )
    const reads = googlechatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googlechatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['find.member', 'get.direct.message.details', 'get.message.details', 'search.messages'].sort(),
    )
    expect(mutations).toEqual(['add.aspace.member', 'send.amessage'].sort())
  })
})
