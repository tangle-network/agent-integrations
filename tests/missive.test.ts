import { describe, expect, it } from 'vitest'
import { missiveConnector } from '../src/connectors/adapters/missive.js'

describe('missive adapter manifest', () => {
  it('classifies itself as the comms category and exposes the missive kind', () => {
    expect(missiveConnector.manifest.kind).toBe('missive')
    expect(missiveConnector.manifest.category).toBe('comms')
    expect(missiveConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = missiveConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: contact find/create/update, draft post, task create', () => {
    const names = missiveConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.find',
        'contacts.create',
        'contacts.update',
        'drafts.create',
        'tasks.create',
      ].sort(),
    )
    const reads = missiveConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = missiveConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.find'])
    expect(mutations).toEqual(
      ['contacts.create', 'contacts.update', 'drafts.create', 'tasks.create'].sort(),
    )
  })
})
