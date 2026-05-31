import { describe, expect, it } from 'vitest'
import { everhourConnector } from '../src/connectors/adapters/everhour.js'

describe('everhour adapter manifest', () => {
  it('classifies itself as the other category and exposes the everhour kind', () => {
    expect(everhourConnector.manifest.kind).toBe('everhour')
    expect(everhourConnector.manifest.category).toBe('other')
    expect(everhourConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = everhourConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: tasks and timers', () => {
    const names = everhourConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['tasks.create', 'timers.start', 'timers.stop'])
    const mutations = everhourConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['tasks.create', 'timers.start', 'timers.stop'])
  })
})
