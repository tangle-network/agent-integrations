import { describe, expect, it } from 'vitest'
import { webscrapingAiConnector } from '../src/connectors/adapters/webscraping-ai.js'

describe('webscraping-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the webscraping-ai kind', () => {
    expect(webscrapingAiConnector.manifest.kind).toBe('webscraping-ai')
    expect(webscrapingAiConnector.manifest.category).toBe('other')
    expect(webscrapingAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = webscrapingAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: scrape text, scrape html, extract data, and account info', () => {
    const names = webscrapingAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['account.info', 'data.extract', 'page.scrapeHtml', 'page.scrapeText'])
    const reads = webscrapingAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['account.info', 'data.extract', 'page.scrapeHtml', 'page.scrapeText'])
  })
})
