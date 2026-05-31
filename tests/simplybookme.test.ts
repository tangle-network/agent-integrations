import { describe, expect, it } from 'vitest'
import { simplybookmeConnector } from '../src/connectors/adapters/simplybookme.js'

describe('simplybookme adapter manifest', () => {
  it('classifies itself as the other category and exposes the simplybookme kind', () => {
    expect(simplybookmeConnector.manifest.kind).toBe('simplybookme')
    expect(simplybookmeConnector.manifest.category).toBe('other')
    expect(simplybookmeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a SimplyBook.me-specific hint', () => {
    const auth = simplybookmeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SimplyBook/i)
  })

  it('covers bookings, clients, invoices, and notes capability surface', () => {
    const names = simplybookmeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('bookings.create')
    expect(names).toContain('bookings.find')
    expect(names).toContain('bookings.cancel')
    expect(names).toContain('bookings.addComment')
    expect(names).toContain('clients.create')
    expect(names).toContain('clients.find')
    expect(names).toContain('clients.delete')
    expect(names).toContain('invoices.find')
    expect(names).toContain('notes.create')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = simplybookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('bookings.create')
    expect(mutations).toContain('bookings.cancel')
    expect(mutations).toContain('bookings.addComment')
    expect(mutations).toContain('clients.create')
    expect(mutations).toContain('clients.delete')
    expect(mutations).toContain('notes.create')
  })

  it('marks read-only operations as read', () => {
    const reads = simplybookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('bookings.find')
    expect(reads).toContain('clients.find')
    expect(reads).toContain('invoices.find')
  })
})
