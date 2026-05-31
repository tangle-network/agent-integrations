import { describe, expect, it } from 'vitest'
import { lucidyaConnector } from '../src/connectors/adapters/lucidya.js'

describe('lucidya adapter manifest', () => {
  it('classifies itself as the crm category and exposes the lucidya kind', () => {
    expect(lucidyaConnector.manifest.kind).toBe('lucidya')
    expect(lucidyaConnector.manifest.category).toBe('crm')
    expect(lucidyaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = lucidyaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the documented Lucidya REST surface: channels, mentions, tickets, analytics, reports', () => {
    const names = lucidyaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('account.get')
    expect(names).toContain('channels.list')
    expect(names).toContain('mentions.search')
    expect(names).toContain('mentions.reply')
    expect(names).toContain('tickets.create')
    expect(names).toContain('analytics.sentiment')
    expect(names).toContain('reports.list')

    const reads = lucidyaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = lucidyaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)

    expect(reads.length).toBeGreaterThan(0)
    expect(mutations.length).toBeGreaterThan(0)
    expect(mutations).toContain('mentions.reply')
    expect(mutations).toContain('tickets.create')
  })
})
