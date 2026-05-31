import { describe, expect, it } from 'vitest'
import { acumbamailConnector } from '../src/connectors/adapters/acumbamail.js'

describe('acumbamail adapter manifest', () => {
  it('classifies itself as the comms category and exposes the acumbamail kind', () => {
    expect(acumbamailConnector.manifest.kind).toBe('acumbamail')
    expect(acumbamailConnector.manifest.category).toBe('comms')
    expect(acumbamailConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = acumbamailConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: subscriber + list + template ops', () => {
    const names = acumbamailConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'lists.create',
        'lists.delete',
        'lists.query',
        'subscriber.add_update',
        'subscriber.remove',
        'subscriber.search',
        'subscriber.unsubscribe',
        'templates.duplicate',
      ].sort(),
    )
    const reads = acumbamailConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = acumbamailConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['lists.query', 'subscriber.search'])
    expect(mutations).toEqual(
      [
        'lists.create',
        'lists.delete',
        'subscriber.add_update',
        'subscriber.remove',
        'subscriber.unsubscribe',
        'templates.duplicate',
      ].sort(),
    )
  })
})
