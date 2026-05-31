import { describe, expect, it } from 'vitest'
import { microsoftOutlookConnector } from '../src/connectors/adapters/microsoft-outlook.js'

describe('microsoft-outlook adapter manifest', () => {
  it('classifies itself as comms and exposes the microsoft-outlook kind', () => {
    expect(microsoftOutlookConnector.manifest.kind).toBe('microsoft-outlook')
    expect(microsoftOutlookConnector.manifest.category).toBe('comms')
    expect(microsoftOutlookConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth against the Microsoft identity platform v2.0 common tenant', () => {
    const auth = microsoftOutlookConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('expected oauth2 auth')
    expect(auth.authorizationUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(auth.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['offline_access', 'Mail.ReadWrite', 'Mail.Send']),
    )
  })

  it('covers the catalog mail action surface', () => {
    const names = microsoftOutlookConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'email.approval.request',
      'email.attachment.download',
      'email.draft.create',
      'email.draft.send',
      'email.find',
      'email.forward',
      'email.label.add',
      'email.label.remove',
      'email.move',
      'email.reply',
      'email.send',
    ])
  })

  it('marks every mutation with cas + externalEffect and a Mail.* scope', () => {
    const mutations = microsoftOutlookConnector.manifest.capabilities.filter(
      (cap) => cap.class === 'mutation',
    )
    expect(mutations.length).toBeGreaterThanOrEqual(8)
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.externalEffect).toBe(true)
      expect(['native-idempotency', 'etag-if-match', 'optimistic-read-verify', 'none']).toContain(
        cap.cas,
      )
      const scopes = cap.requiredScopes ?? []
      expect(scopes.some((s) => s === 'Mail.Send' || s === 'Mail.ReadWrite')).toBe(true)
    }
  })
})
