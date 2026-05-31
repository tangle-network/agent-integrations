import { describe, expect, it } from 'vitest'
import { opportifyConnector } from '../src/connectors/adapters/opportify.js'

describe('opportify adapter manifest', () => {
  it('classifies itself as the other category and exposes the opportify kind', () => {
    expect(opportifyConnector.manifest.kind).toBe('opportify')
    expect(opportifyConnector.manifest.category).toBe('other')
    expect(opportifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = opportifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (analyze email, analyze ip)', () => {
    const names = opportifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['analyze.email', 'analyze.ip.address'].sort())
    const reads = opportifyConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['analyze.email', 'analyze.ip.address'].sort())
  })
})
