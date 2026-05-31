import { describe, expect, it } from 'vitest'
import { flowiseConnector } from '../src/connectors/adapters/flowise.js'

describe('flowise adapter manifest', () => {
  it('exposes the flowise kind and workflow-shaped category', () => {
    expect(flowiseConnector.manifest.kind).toBe('flowise')
    expect(flowiseConnector.manifest.category).toBe('other')
    expect(flowiseConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = flowiseConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

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
