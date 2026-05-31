import { describe, expect, it } from 'vitest'
import { generatebannersConnector } from '../src/connectors/adapters/generatebanners.js'

describe('generatebanners adapter manifest', () => {
  it('classifies itself as the storage category and exposes the generatebanners kind', () => {
    expect(generatebannersConnector.manifest.kind).toBe('generatebanners')
    expect(generatebannersConnector.manifest.category).toBe('storage')
    expect(generatebannersConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = generatebannersConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/GenerateBanners/i)
  })

  it('exposes templates.render as a mutation capability', () => {
    const names = generatebannersConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['templates.render'].sort())
    const mutations = generatebannersConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toContain('templates.render')
  })
})
