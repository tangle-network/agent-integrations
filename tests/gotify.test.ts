import { describe, expect, it } from 'vitest'
import { gotifyConnector } from '../src/connectors/adapters/gotify.js'

describe('gotify adapter manifest', () => {
  it('classifies itself as the comms category and exposes the gotify kind', () => {
    expect(gotifyConnector.manifest.kind).toBe('gotify')
    expect(gotifyConnector.manifest.category).toBe('comms')
    expect(gotifyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = gotifyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (send notification)', () => {
    const names = gotifyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['notification.send'])

    const mutations = gotifyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['notification.send'])
  })
})
