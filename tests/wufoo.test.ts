import { describe, expect, it } from 'vitest'
import { wufooConnector } from '../src/connectors/adapters/wufoo.js'

describe('wufoo adapter manifest', () => {
  it('classifies itself as the other category and exposes the wufoo kind', () => {
    expect(wufooConnector.manifest.kind).toBe('wufoo')
    expect(wufooConnector.manifest.category).toBe('other')
    expect(wufooConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Wufoo-specific hint', () => {
    const auth = wufooConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Wufoo/i)
  })

  it('covers forms and entries capability surface', () => {
    const names = wufooConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('entries.create')
    expect(names).toContain('entries.get')
    expect(names).toContain('entries.list')
    expect(names).toContain('entries.search')
    expect(names).toContain('fields.list')
    expect(names).toContain('forms.find')
    expect(names).toContain('forms.list')
  })

  it('marks form entry creation as mutation', () => {
    const mutations = wufooConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('entries.create')
  })

  it('marks read-only operations as read', () => {
    const reads = wufooConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('entries.get')
    expect(reads).toContain('entries.list')
    expect(reads).toContain('entries.search')
    expect(reads).toContain('fields.list')
    expect(reads).toContain('forms.find')
    expect(reads).toContain('forms.list')
  })
})
