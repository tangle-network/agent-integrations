import { describe, expect, it } from 'vitest'
import { flowiseConnector } from '../src/connectors/adapters/flowise.js'

describe('flowise adapter manifest', () => {
  it('covers prediction.invoke plus chatflow read paths', () => {
    const names = flowiseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['chatflows.get', 'chatflows.list', 'prediction.invoke'])

    const reads = flowiseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = flowiseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['chatflows.get', 'chatflows.list'])
    expect(mutations).toEqual(['prediction.invoke'])
  })
})
