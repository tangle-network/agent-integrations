import { describe, expect, it } from 'vitest'
import { scrapegraphaiConnector } from '../src/connectors/adapters/scrapegraphai.js'

describe('scrapegraphai adapter manifest', () => {
  it('classifies itself as the other category and exposes the scrapegraphai kind', () => {
    expect(scrapegraphaiConnector.manifest.kind).toBe('scrapegraphai')
    expect(scrapegraphaiConnector.manifest.category).toBe('other')
    expect(scrapegraphaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = scrapegraphaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (smart scraper, local scraper, markdownify)', () => {
    const names = scrapegraphaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['scraper.smart', 'scraper.local', 'markdown.convert'].sort())

    const reads = scrapegraphaiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['scraper.smart', 'scraper.local', 'markdown.convert'].sort())

    const mutations = scrapegraphaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual([])
  })
})
