import { describe, expect, it } from 'vitest'
import { heartbeatConnector } from '../src/connectors/adapters/heartbeat.js'

describe('heartbeat adapter manifest', () => {
  it('classifies itself as the comms category and exposes the heartbeat kind', () => {
    expect(heartbeatConnector.manifest.kind).toBe('heartbeat')
    expect(heartbeatConnector.manifest.category).toBe('comms')
    expect(heartbeatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = heartbeatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (users.create)', () => {
    const names = heartbeatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['users.create'])
    const mutations = heartbeatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['users.create'])
  })
})
