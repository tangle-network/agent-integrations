import { describe, expect, it } from 'vitest'
import { scrapelessConnector } from '../src/connectors/adapters/scrapeless.js'

describe('scrapeless adapter manifest', () => {
  it('classifies itself as the other category and exposes the scrapeless kind', () => {
    expect(scrapelessConnector.manifest.kind).toBe('scrapeless')
    expect(scrapelessConnector.manifest.category).toBe('other')
    expect(scrapelessConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = scrapelessConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: google search, universal scraping, website crawl, and google trends', () => {
    const names = scrapelessConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['crawl.website', 'scrape.universal', 'search.google', 'trends.google'])
    const reads = scrapelessConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['crawl.website', 'scrape.universal', 'search.google', 'trends.google'])
  })
})
