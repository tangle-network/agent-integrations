import { describe, expect, it } from 'vitest'
import { elevenlabsConnector } from '../src/connectors/adapters/elevenlabs.js'

describe('elevenlabs adapter manifest', () => {
  it('classifies itself as the other category and exposes the elevenlabs kind', () => {
    expect(elevenlabsConnector.manifest.kind).toBe('elevenlabs')
    expect(elevenlabsConnector.manifest.category).toBe('other')
    expect(elevenlabsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = elevenlabsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the text-to-speech capability', () => {
    const capabilities = elevenlabsConnector.manifest.capabilities
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0].name).toBe('speech.synthesis')
    expect(capabilities[0].class).toBe('mutation')
  })
})
