import { describe, expect, it } from 'vitest'
import { swarmnodeConnector } from '../src/connectors/adapters/swarmnode.js'

describe('swarmnode adapter manifest', () => {
  it('classifies itself as the other category and exposes the swarmnode kind', () => {
    expect(swarmnodeConnector.manifest.kind).toBe('swarmnode')
    expect(swarmnodeConnector.manifest.category).toBe('other')
    expect(swarmnodeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = swarmnodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (execution.get, agent.execute)', () => {
    const names = swarmnodeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['agent.execute', 'execution.get'].sort())
    const reads = swarmnodeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = swarmnodeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['execution.get'].sort())
    expect(mutations).toEqual(['agent.execute'].sort())
  })
})
