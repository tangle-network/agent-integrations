import { describe, expect, it } from 'vitest'
import { omniCoConnector } from '../src/connectors/adapters/omni-co.js'

describe('omni-co adapter manifest', () => {
  it('classifies itself as the database category and exposes the omni-co kind', () => {
    expect(omniCoConnector.manifest.kind).toBe('omni-co')
    expect(omniCoConnector.manifest.category).toBe('database')
    expect(omniCoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = omniCoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Omni/i)
  })

  it('covers document, query, and schedule capability surface', () => {
    const names = omniCoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'documents.create',
        'documents.delete',
        'documents.move',
        'queries.generate',
        'queries.run',
        'schedules.create',
        'schedules.delete',
        'schedules.edit',
      ].sort(),
    )
    const mutations = omniCoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'documents.create',
        'documents.delete',
        'documents.move',
        'schedules.create',
        'schedules.delete',
        'schedules.edit',
      ].sort(),
    )
  })
})
