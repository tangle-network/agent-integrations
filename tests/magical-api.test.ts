import { describe, expect, it } from 'vitest'
import { magicalApiConnector } from '../src/connectors/adapters/magical-api.js'

describe('magical-api adapter manifest', () => {
  it('classifies itself as the crm category and exposes the magical-api kind', () => {
    expect(magicalApiConnector.manifest.kind).toBe('magical-api')
    expect(magicalApiConnector.manifest.category).toBe('crm')
    expect(magicalApiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth with a Magical-API-specific hint', () => {
    const auth = magicalApiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Magical API/i)
  })

  it('covers the parse, review, score, profile, and company capability surface', () => {
    const names = magicalApiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'resume.parse',
        'resume.review',
        'resume.score',
        'profile.get',
        'company.get',
      ].sort(),
    )
    const reads = magicalApiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = magicalApiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['company.get', 'profile.get'].sort())
    expect(mutations).toEqual(['resume.parse', 'resume.review', 'resume.score'].sort())
  })
})
