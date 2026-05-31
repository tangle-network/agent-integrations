import { describe, expect, it } from 'vitest'
import { dumplingAiConnector } from '../src/connectors/adapters/dumpling-ai.js'

describe('dumpling-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the dumpling-ai kind', () => {
    expect(dumplingAiConnector.manifest.kind).toBe('dumpling-ai')
    expect(dumplingAiConnector.manifest.category).toBe('other')
    expect(dumplingAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = dumplingAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Dumpling/i)
  })

  it('covers the web, document, image, and news capability surface', () => {
    const names = dumplingAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'web.crawl',
        'web.scrape',
        'document.extract',
        'image.generate',
        'search.news',
      ].sort(),
    )
    const mutations = dumplingAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['web.crawl', 'web.scrape', 'document.extract', 'image.generate', 'search.news'].sort(),
    )
  })
})
