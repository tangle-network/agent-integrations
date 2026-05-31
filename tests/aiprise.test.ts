import { describe, expect, it } from 'vitest'
import { aipriseConnector } from '../src/connectors/adapters/aiprise.js'

describe('aiprise adapter manifest', () => {
  it('classifies itself as the database category and exposes the aiprise kind', () => {
    expect(aipriseConnector.manifest.kind).toBe('aiprise')
    expect(aipriseConnector.manifest.category).toBe('database')
    expect(aipriseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = aipriseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AiPrise/i)
  })

  it('covers the identity, business, document, and profile capability surface', () => {
    const names = aipriseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'identity.verification.start',
        'identity.verification.url',
        'identity.verification.result',
        'identity.verification.input',
        'identity.verification.update_result',
        'identity.user_info.get',
        'business.verification.start',
        'business.verification.result',
        'business.verification.input',
        'document.check.run',
        'business.profile.create',
        'business.profile.get',
        'business.profile.documents',
        'business.search',
        'user.profile.create',
        'user.profile.get',
      ].sort(),
    )
    const reads = aipriseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = aipriseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'identity.verification.url',
        'identity.verification.result',
        'identity.verification.input',
        'identity.user_info.get',
        'business.verification.result',
        'business.verification.input',
        'business.profile.get',
        'business.profile.documents',
        'business.search',
        'user.profile.get',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'identity.verification.start',
        'identity.verification.update_result',
        'business.verification.start',
        'document.check.run',
        'business.profile.create',
        'user.profile.create',
      ].sort(),
    )
  })
})
