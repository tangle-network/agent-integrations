import { describe, expect, it } from 'vitest'
import { googleSearchConsoleConnector } from '../src/connectors/adapters/google-search-console.js'

describe('google-search-console adapter manifest', () => {
  it('exposes the google-search-console kind and maps the activepieces "workflow" piece category onto an allowed connector category', () => {
    expect(googleSearchConsoleConnector.manifest.kind).toBe('google-search-console')
    // Catalog category is "workflow"; the connector category enum doesn't have
    // "workflow", and Search Console isn't a calendar/spreadsheet/CRM/etc., so
    // we land it in "other" — the explicit fallback the type permits.
    expect(googleSearchConsoleConnector.manifest.category).toBe('other')
    expect(googleSearchConsoleConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = googleSearchConsoleConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (URL inspection, search analytics, sitemaps, sites)', () => {
    const names = googleSearchConsoleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'urlInspection.index',
        'searchAnalytics.query',
        'sites.list',
        'sites.add',
        'sites.delete',
        'sitemaps.list',
        'sitemaps.submit',
      ].sort(),
    )
    const reads = googleSearchConsoleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googleSearchConsoleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['urlInspection.index', 'searchAnalytics.query', 'sites.list', 'sitemaps.list'].sort(),
    )
    expect(mutations).toEqual(['sites.add', 'sites.delete', 'sitemaps.submit'].sort())
  })
})
