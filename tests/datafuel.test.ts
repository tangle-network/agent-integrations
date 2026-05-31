import { describe, expect, it } from 'vitest'
import { datafuelConnector } from '../src/connectors/adapters/datafuel.js'

describe('datafuel adapter manifest', () => {
  it('classifies itself as the other category and exposes the datafuel kind', () => {
    expect(datafuelConnector.manifest.kind).toBe('datafuel')
    expect(datafuelConnector.manifest.category).toBe('other')
    expect(datafuelConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = datafuelConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (crawl, scrape, get scrape)', () => {
    const names = datafuelConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['crawl.website', 'get.scrape', 'scrape.website'].sort())
    const reads = datafuelConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = datafuelConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.scrape'])
    expect(mutations).toEqual(['crawl.website', 'scrape.website'].sort())
  })
})
