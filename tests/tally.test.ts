import { describe, expect, it } from 'vitest'
import { tallyConnector } from '../src/connectors/adapters/tally.js'

describe('tally adapter manifest', () => {
  it('classifies itself as the other category and exposes the tally kind', () => {
    expect(tallyConnector.manifest.kind).toBe('tally')
    expect(tallyConnector.manifest.category).toBe('other')
    expect(tallyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = tallyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes form metadata and response listing capabilities', () => {
    const names = tallyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['form.get', 'form.responses.list'].sort())

    const reads = tallyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['form.get', 'form.responses.list'].sort())

    const mutations = tallyConnector.manifest.capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(mutations).toEqual([])
  })
})
