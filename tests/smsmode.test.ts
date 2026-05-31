import { describe, expect, it } from 'vitest'
import { smsmodeConnector } from '../src/connectors/adapters/smsmode.js'

describe('smsmode adapter manifest', () => {
  it('classifies itself as the comms category and exposes the smsmode kind', () => {
    expect(smsmodeConnector.manifest.kind).toBe('smsmode')
    expect(smsmodeConnector.manifest.category).toBe('comms')
    expect(smsmodeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = smsmodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the send.message action', () => {
    const names = smsmodeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['messages.send'])

    const mutations = smsmodeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(['messages.send'])
  })
})
