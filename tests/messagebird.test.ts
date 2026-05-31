import { describe, expect, it } from 'vitest'
import { messagebirdConnector } from '../src/connectors/adapters/messagebird.js'

describe('messagebird adapter manifest', () => {
  it('classifies itself as the crm category and exposes the messagebird kind', () => {
    expect(messagebirdConnector.manifest.kind).toBe('messagebird')
    expect(messagebirdConnector.manifest.category).toBe('crm')
    expect(messagebirdConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = messagebirdConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (send.sms, list.messages)', () => {
    const names = messagebirdConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['list.messages', 'send.sms'].sort())
    const reads = messagebirdConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = messagebirdConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['list.messages'])
    expect(mutations).toEqual(['send.sms'])
  })
})
