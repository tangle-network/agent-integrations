import { describe, expect, it } from 'vitest'
import { umamiConnector } from '../src/connectors/adapters/umami.js'

describe('umami adapter manifest', () => {
  it('classifies itself as the database category and exposes the umami kind', () => {
    expect(umamiConnector.manifest.kind).toBe('umami')
    expect(umamiConnector.manifest.category).toBe('database')
    expect(umamiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = umamiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Umami/i)
  })

  it('covers read and mutation capability surfaces', () => {
    const names = umamiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'websites.list',
        'website.stats',
        'website.metrics',
        'website.active_visitors',
        'website.pageviews',
        'event.send',
      ].sort(),
    )
    const mutations = umamiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['event.send'].sort())
  })
})
