import { describe, expect, it } from 'vitest'
import { tlDvConnector } from '../src/connectors/adapters/tl-dv.js'

describe('tl-dv adapter manifest', () => {
  it('classifies itself as the docs category and exposes the tl-dv kind', () => {
    expect(tlDvConnector.manifest.kind).toBe('tl-dv')
    expect(tlDvConnector.manifest.category).toBe('doc')
    expect(tlDvConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = tlDvConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/tl;dv/i)
  })

  it('covers meetings, transcripts, and highlights capability surface', () => {
    const names = tlDvConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'meetings.list',
        'meetings.get',
        'meetings.upload',
        'transcripts.get',
        'highlights.get',
      ].sort(),
    )
    const mutations = tlDvConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['meetings.upload'].sort())
  })
})
