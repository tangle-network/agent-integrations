import { describe, expect, it } from 'vitest'
import { devinConnector } from '../src/connectors/adapters/devin.js'

describe('devin adapter manifest', () => {
  it('classifies itself as the other category and exposes the devin kind', () => {
    expect(devinConnector.manifest.kind).toBe('devin')
    expect(devinConnector.manifest.category).toBe('other')
    expect(devinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = devinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (create session, get details, send message)', () => {
    const names = devinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.session', 'get.session.details', 'send.message'].sort())
    const reads = devinConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = devinConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.session.details'])
    expect(mutations).toEqual(['create.session', 'send.message'].sort())
  })
})
