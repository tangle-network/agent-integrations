import { describe, expect, it } from 'vitest'
import { alttextifyConnector } from '../src/connectors/adapters/alttextify.js'

describe('alttextify adapter manifest', () => {
  it('classifies itself as the doc category and exposes the alttextify kind', () => {
    expect(alttextifyConnector.manifest.kind).toBe('alttextify')
    expect(alttextifyConnector.manifest.category).toBe('doc')
    expect(alttextifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = alttextifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AltTextify/i)
  })

  it('exposes the generate alt text mutation capability from the upstream action', () => {
    const names = alttextifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['generate.alt.text'])
    const mutations = alttextifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['generate.alt.text'])
  })
})
