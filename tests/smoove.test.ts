import { describe, expect, it } from 'vitest'
import { smooveConnector } from '../src/connectors/adapters/smoove.js'

describe('smoove adapter manifest', () => {
  it('classifies itself as the crm category and exposes the smoove kind', () => {
    expect(smooveConnector.manifest.kind).toBe('smoove')
    expect(smooveConnector.manifest.category).toBe('crm')
    expect(smooveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Smoove-specific hint', () => {
    const auth = smooveConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Smoove/i)
  })

  it('covers lists and subscribers capability surface', () => {
    const names = smooveConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('lists.get')
    expect(names).toContain('lists.create')
    expect(names).toContain('subscribers.add')
    expect(names).toContain('subscribers.find')
    expect(names).toContain('subscribers.unsubscribe')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = smooveConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('subscribers.add')
    expect(mutations).toContain('subscribers.unsubscribe')
    expect(mutations).toContain('lists.create')
  })

  it('marks read-only operations as read', () => {
    const reads = smooveConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('lists.get')
    expect(reads).toContain('subscribers.find')
  })
})
