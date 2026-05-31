import { describe, expect, it } from 'vitest'
import { glideConnector } from '../src/connectors/adapters/glide.js'

describe('glide adapter manifest', () => {
  it('classifies itself as the doc category and exposes the glide kind', () => {
    expect(glideConnector.manifest.kind).toBe('glide')
    expect(glideConnector.manifest.category).toBe('doc')
    expect(glideConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = glideConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Glide/i)
  })

  it('covers the table and row capability surface', () => {
    const names = glideConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tables.list',
        'rows.get',
        'rows.add',
        'rows.update',
        'rows.delete',
      ].sort(),
    )
    const mutations = glideConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['rows.add', 'rows.update', 'rows.delete'].sort(),
    )
  })
})
