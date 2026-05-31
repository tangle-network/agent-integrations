import { describe, expect, it } from 'vitest'
import { simplirouteConnector } from '../src/connectors/adapters/simpliroute.js'

describe('simpliroute adapter manifest', () => {
  it('classifies itself as the commerce category and exposes the simpliroute kind', () => {
    expect(simplirouteConnector.manifest.kind).toBe('simpliroute')
    expect(simplirouteConnector.manifest.category).toBe('commerce')
    expect(simplirouteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a SimpliRoute-specific hint', () => {
    const auth = simplirouteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SimpliRoute/i)
  })

  it('covers account, clients, vehicles, visits, routes, and planning capability surface', () => {
    const names = simplirouteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('account.getMe')
    expect(names).toContain('clients.list')
    expect(names).toContain('clients.create')
    expect(names).toContain('clients.bulkDelete')
    expect(names).toContain('vehicles.list')
    expect(names).toContain('vehicles.create')
    expect(names).toContain('vehicles.delete')
    expect(names).toContain('visits.list')
    expect(names).toContain('visits.create')
    expect(names).toContain('visits.delete')
    expect(names).toContain('routes.list')
    expect(names).toContain('routes.create')
    expect(names).toContain('routes.delete')
    expect(names).toContain('plans.list')
    expect(names).toContain('plans.create')
    expect(names).toContain('users.list')
    expect(names).toContain('users.create')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = simplirouteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('clients.create')
    expect(mutations).toContain('clients.bulkDelete')
    expect(mutations).toContain('vehicles.create')
    expect(mutations).toContain('vehicles.delete')
    expect(mutations).toContain('visits.create')
    expect(mutations).toContain('visits.delete')
    expect(mutations).toContain('routes.create')
    expect(mutations).toContain('routes.delete')
    expect(mutations).toContain('plans.create')
    expect(mutations).toContain('users.create')
    expect(mutations).toContain('users.update')
  })

  it('marks read-only operations as read', () => {
    const reads = simplirouteConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('account.getMe')
    expect(reads).toContain('clients.list')
    expect(reads).toContain('vehicles.list')
    expect(reads).toContain('visits.list')
    expect(reads).toContain('routes.list')
    expect(reads).toContain('plans.list')
    expect(reads).toContain('users.list')
    expect(reads).toContain('drivers.list')
  })
})
