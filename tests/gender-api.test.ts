import { describe, expect, it } from 'vitest'
import { genderApiConnector } from '../src/connectors/adapters/gender-api.js'

describe('gender-api adapter manifest', () => {
  it('classifies itself as the other category and exposes the gender-api kind', () => {
    expect(genderApiConnector.manifest.kind).toBe('gender-api')
    expect(genderApiConnector.manifest.category).toBe('other')
    expect(genderApiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = genderApiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Gender API/i)
  })

  it('covers gender prediction and statistics capabilities', () => {
    const names = genderApiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['gender.get.by.first.name', 'gender.get.by.full.name', 'statistics.get'].sort())
    const reads = genderApiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['gender.get.by.first.name', 'gender.get.by.full.name', 'statistics.get'].sort(),
    )
  })
})
