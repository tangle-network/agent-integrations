import { describe, expect, it } from 'vitest'
import { ninjapipeConnector } from '../src/connectors/adapters/ninjapipe.js'

describe('ninjapipe adapter manifest', () => {
  it('classifies itself as the crm category and exposes the ninjapipe kind', () => {
    expect(ninjapipeConnector.manifest.kind).toBe('ninjapipe')
    expect(ninjapipeConnector.manifest.category).toBe('crm')
    expect(ninjapipeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = ninjapipeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/NinjaPipe/i)
  })

  it('covers contacts, companies, deals, tasks, projects, products, and orders', () => {
    const names = ninjapipeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names.length).toBeGreaterThanOrEqual(35)
    expect(names).toContain('contacts.list')
    expect(names).toContain('contacts.create')
    expect(names).toContain('contacts.update')
    expect(names).toContain('companies.list')
    expect(names).toContain('deals.list')
    expect(names).toContain('tasks.list')
    expect(names).toContain('projects.list')
    expect(names).toContain('products.list')
    expect(names).toContain('orders.list')
  })

  it('exposes read and mutation capabilities', () => {
    const capabilities = ninjapipeConnector.manifest.capabilities
    const reads = capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = capabilities.filter((c) => c.class === 'mutation').map((c) => c.name).sort()
    expect(reads.length).toBeGreaterThan(0)
    expect(mutations.length).toBeGreaterThan(0)
    expect(reads).toContain('contacts.list')
    expect(mutations).toContain('contacts.create')
  })
})
