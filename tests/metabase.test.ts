import { describe, expect, it } from 'vitest'
import { metabaseConnector } from '../src/connectors/adapters/metabase.js'

describe('metabase adapter manifest', () => {
  it('classifies itself as the database category and exposes the metabase kind', () => {
    expect(metabaseConnector.manifest.kind).toBe('metabase')
    expect(metabaseConnector.manifest.category).toBe('database')
    expect(metabaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = metabaseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Metabase/i)
  })

  it('covers questions, dashboards, and embedding capability surfaces', () => {
    const names = metabaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'questions.get',
        'questions.preview',
        'dashboards.get_questions',
        'questions.graph_render',
        'questions.embed',
      ].sort(),
    )
    const mutations = metabaseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['questions.embed'])
  })
})
