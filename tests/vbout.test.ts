import { describe, expect, it } from 'vitest'
import { vboutConnector } from '../src/connectors/adapters/vbout.js'

describe('vbout adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vbout kind', () => {
    expect(vboutConnector.manifest.kind).toBe('vbout')
    expect(vboutConnector.manifest.category).toBe('crm')
    expect(vboutConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with VBOUT-specific hint', () => {
    const auth = vboutConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/VBOUT/i)
  })

  it('covers contacts, tags, lists, campaigns, and social messaging capability surface', () => {
    const names = vboutConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.get')
    expect(names).toContain('contacts.list')
    expect(names).toContain('contacts.create')
    expect(names).toContain('contacts.update')
    expect(names).toContain('contacts.unsubscribe')
    expect(names).toContain('tags.add')
    expect(names).toContain('tags.remove')
    expect(names).toContain('lists.get')
    expect(names).toContain('lists.create')
    expect(names).toContain('campaigns.create')
    expect(names).toContain('social.messages.create')
  })

  it('marks mutating operations as mutations', () => {
    const mutations = vboutConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('contacts.create')
    expect(mutations).toContain('contacts.update')
    expect(mutations).toContain('contacts.unsubscribe')
    expect(mutations).toContain('tags.add')
    expect(mutations).toContain('tags.remove')
    expect(mutations).toContain('lists.create')
    expect(mutations).toContain('campaigns.create')
    expect(mutations).toContain('social.messages.create')
  })

  it('marks read-only operations as read', () => {
    const reads = vboutConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('contacts.get')
    expect(reads).toContain('contacts.list')
    expect(reads).toContain('lists.get')
  })
})
