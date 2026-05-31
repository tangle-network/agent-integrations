import { describe, expect, it } from 'vitest'
import { hystructConnector } from '../src/connectors/adapters/hystruct.js'

describe('hystruct adapter manifest', () => {
  it('classifies itself as the other category and exposes the hystruct kind', () => {
    expect(hystructConnector.manifest.kind).toBe('hystruct')
    expect(hystructConnector.manifest.category).toBe('other')
    expect(hystructConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = hystructConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Hystruct/i)
  })

  it('covers the job.create capability', () => {
    const names = hystructConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['job.create'])
    const mutations = hystructConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['job.create'])
  })
})
