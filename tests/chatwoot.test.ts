import { describe, expect, it } from 'vitest'
import { chatwootConnector } from '../src/connectors/adapters/chatwoot.js'

describe('chatwoot adapter manifest', () => {
  it('identifies itself as the chatwoot kind under the comms category', () => {
    expect(chatwootConnector.manifest.kind).toBe('chatwoot')
    expect(chatwootConnector.manifest.category).toBe('comms')
    expect(chatwootConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = chatwootConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the upstream send.message action as a mutation', () => {
    const names = chatwootConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['send.message'])
    const sendMessage = chatwootConnector.manifest.capabilities.find(
      (c) => c.name === 'send.message',
    )
    expect(sendMessage?.class).toBe('mutation')
  })
})
