import { describe, expect, it } from 'vitest'
import { airtopConnector } from '../src/connectors/adapters/airtop.js'

describe('airtop adapter manifest', () => {
  it('exposes the airtop kind and other category for cloud browser automation', () => {
    expect(airtopConnector.manifest.kind).toBe('airtop')
    expect(airtopConnector.manifest.category).toBe('other')
    expect(airtopConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = airtopConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: sessions, windows, query/scrape, and interactions', () => {
    const names = airtopConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'sessions.create',
        'sessions.terminate',
        'sessions.uploadFile',
        'windows.create',
        'windows.screenshot',
        'windows.pageQuery',
        'windows.smartScrape',
        'windows.paginatedExtraction',
        'windows.click',
        'windows.type',
        'windows.hover',
      ].sort(),
    )
    const reads = airtopConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['windows.pageQuery', 'windows.screenshot'].sort())
  })
})
