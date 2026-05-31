import { describe, expect, it } from 'vitest'
import { matrixConnector } from '../src/connectors/adapters/matrix.js'

describe('matrix adapter manifest', () => {
  it('classifies itself as the comms category and exposes the matrix kind', () => {
    expect(matrixConnector.manifest.kind).toBe('matrix')
    // activepieces piece category is "chat"; we map chat -> comms because the
    // connector type union has no chat member and Matrix is fundamentally a
    // communications surface.
    expect(matrixConnector.manifest.category).toBe('comms')
    expect(matrixConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape: access_token)', () => {
    const auth = matrixConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes send.message (the activepieces action) plus the read/lifecycle ops it transitively needs', () => {
    const names = matrixConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('send.message')
    // send.message takes a roomId, not a room alias; alias resolution must be a callable read.
    expect(names).toContain('rooms.resolveAlias')
    const sendMessage = matrixConnector.manifest.capabilities.find((c) => c.name === 'send.message')
    expect(sendMessage?.class).toBe('mutation')
    if (sendMessage && sendMessage.class === 'mutation') {
      expect(sendMessage.cas).toBe('native-idempotency')
    }
  })
})
