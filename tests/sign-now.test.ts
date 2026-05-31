import { describe, expect, it } from 'vitest'
import { signNowConnector } from '../src/connectors/adapters/sign-now.js'

describe('sign-now adapter manifest', () => {
  it('classifies itself as the docs category and exposes the sign-now kind', () => {
    expect(signNowConnector.manifest.kind).toBe('sign-now')
    expect(signNowConnector.manifest.category).toBe('doc')
    expect(signNowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = signNowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SignNow/i)
  })

  it('covers document upload, invite, and template capability surface', () => {
    const names = signNowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.get',
        'documents.upload',
        'invites.cancel',
        'invites.send',
        'templates.createDocumentFromTemplate',
        'templates.get',
      ].sort(),
    )
    const mutations = signNowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['documents.upload', 'invites.cancel', 'invites.send', 'templates.createDocumentFromTemplate'].sort(),
    )
  })
})
