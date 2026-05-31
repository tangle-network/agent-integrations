import { describe, expect, it } from 'vitest'
import { anyhookWebsocketConnector } from '../src/connectors/adapters/anyhook-websocket.js'

describe('anyhook-websocket adapter manifest', () => {
  it('classifies itself as the other category and exposes the anyhook-websocket kind', () => {
    expect(anyhookWebsocketConnector.manifest.kind).toBe('anyhook-websocket')
    expect(anyhookWebsocketConnector.manifest.category).toBe('other')
    expect(anyhookWebsocketConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = anyhookWebsocketConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog trigger set: websocket subscription', () => {
    const names = anyhookWebsocketConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['websocket.subscribe'])
    const reads = anyhookWebsocketConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['websocket.subscribe'])
  })
})
