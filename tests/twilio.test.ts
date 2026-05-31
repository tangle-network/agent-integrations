import { describe, expect, it } from 'vitest'
import { twilioConnector } from '../src/connectors/adapters/twilio.js'

describe('twilio adapter manifest', () => {
  it('classifies itself as the comms category and exposes the twilio kind', () => {
    expect(twilioConnector.manifest.kind).toBe('twilio')
    expect(twilioConnector.manifest.category).toBe('comms')
    expect(twilioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = twilioConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full capability set (messages, calls, recordings)', () => {
    const names = twilioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'messages.send',
        'messages.get',
        'messages.list',
        'calls.make',
        'calls.get',
        'calls.list',
        'recordings.get',
        'recordings.list',
      ].sort(),
    )
    const reads = twilioConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = twilioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['messages.get', 'messages.list', 'calls.get', 'calls.list', 'recordings.get', 'recordings.list'].sort(),
    )
    expect(mutations).toEqual(['messages.send', 'calls.make'].sort())
  })
})
