import { describe, expect, it } from 'vitest'
import { hastewireConnector } from '../src/connectors/adapters/hastewire.js'

describe('hastewire adapter manifest', () => {
  it('classifies itself as the other category and exposes the hastewire kind', () => {
    expect(hastewireConnector.manifest.kind).toBe('hastewire')
    expect(hastewireConnector.manifest.category).toBe('other')
    expect(hastewireConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares API-key auth matching the activepieces catalog entry', () => {
    const auth = hastewireConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers detect.text and humanize.text capabilities derived from the actions array', () => {
    const names = hastewireConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['detect.text', 'humanize.text'])

    const reads = hastewireConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = hastewireConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)

    expect(reads).toEqual(['detect.text'])
    expect(mutations).toEqual(['humanize.text'])
  })
})
