import { describe, expect, it } from 'vitest'
import { apifyConnector } from '../src/connectors/adapters/apify.js'

describe('apify adapter manifest', () => {
  it('classifies itself as the database category and exposes the apify kind', () => {
    expect(apifyConnector.manifest.kind).toBe('apify')
    expect(apifyConnector.manifest.category).toBe('database')
    expect(apifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = apifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Apify/i)
  })

  it('covers datasets, key-value stores, actors, tasks, and web scraping capability surfaces', () => {
    const names = apifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'datasets.items.get',
        'keyvalue-stores.records.get',
        'actors.run',
        'tasks.run',
        'web-scrape.url',
      ].sort(),
    )
    const mutations = apifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['actors.run', 'tasks.run', 'web-scrape.url'].sort())
  })
})
