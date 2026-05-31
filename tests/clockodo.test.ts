import { describe, expect, it } from 'vitest'
import { clockodoConnector } from '../src/connectors/adapters/clockodo.js'

describe('clockodo adapter manifest', () => {
  it('classifies itself as the other category and exposes the clockodo kind', () => {
    expect(clockodoConnector.manifest.kind).toBe('clockodo')
    expect(clockodoConnector.manifest.category).toBe('other')
    expect(clockodoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = clockodoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers Clockodo entries, customers, projects, services, users, and absences', () => {
    const names = clockodoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'entries.find',
        'entries.get',
        'entries.create',
        'entries.update',
        'entries.delete',
        'customers.find',
        'customers.get',
        'customers.create',
        'projects.find',
        'projects.create',
        'services.find',
        'users.find',
        'absences.find',
        'absences.create',
        'absences.delete',
      ].sort(),
    )

    const reads = clockodoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = clockodoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'entries.find',
        'entries.get',
        'customers.find',
        'customers.get',
        'projects.find',
        'services.find',
        'users.find',
        'absences.find',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'entries.create',
        'entries.update',
        'entries.delete',
        'customers.create',
        'projects.create',
        'absences.create',
        'absences.delete',
      ].sort(),
    )
  })
})
