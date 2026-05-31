import { describe, expect, it } from 'vitest'
import { seekTableConnector } from '../src/connectors/adapters/seek-table.js'

describe('seek-table adapter manifest', () => {
  it('classifies itself as the other category and exposes the seek-table kind', () => {
    expect(seekTableConnector.manifest.kind).toBe('seek-table')
    expect(seekTableConnector.manifest.category).toBe('other')
    expect(seekTableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = seekTableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SeekTable/i)
  })

  it('covers the csv upload and report email share capability surface', () => {
    const names = seekTableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'csv.upload',
        'report.share.email',
      ].sort(),
    )
    const mutations = seekTableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['csv.upload', 'report.share.email'].sort(),
    )
  })
})
