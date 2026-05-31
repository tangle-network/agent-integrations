import { describe, expect, it } from 'vitest'
import { firecrawlConnector } from '../src/connectors/adapters/firecrawl.js'

describe('firecrawl adapter manifest', () => {
  it('classifies itself as the other category and exposes the firecrawl kind', () => {
    expect(firecrawlConnector.manifest.kind).toBe('firecrawl')
    expect(firecrawlConnector.manifest.category).toBe('other')
    expect(firecrawlConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = firecrawlConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (scrape, extract, crawl, crawl.results, map)', () => {
    const names = firecrawlConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['crawl', 'crawl.results', 'extract', 'map', 'scrape'].sort())
    const reads = firecrawlConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = firecrawlConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['crawl.results', 'map'].sort())
    expect(mutations).toEqual(['crawl', 'extract', 'scrape'].sort())
  })
})
