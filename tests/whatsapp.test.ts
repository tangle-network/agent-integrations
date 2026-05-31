import { describe, expect, it } from 'vitest'
import { whatsappConnector } from '../src/connectors/adapters/whatsapp.js'

describe('whatsapp adapter manifest', () => {
  it('classifies itself as the comms category and exposes the whatsapp kind', () => {
    expect(whatsappConnector.manifest.kind).toBe('whatsapp')
    expect(whatsappConnector.manifest.category).toBe('comms')
    expect(whatsappConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a WhatsApp-specific hint', () => {
    const auth = whatsappConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/WhatsApp/i)
  })

  it('covers message, media, and template sending capabilities', () => {
    const names = whatsappConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('media.send')
    expect(names).toContain('messages.send')
    expect(names).toContain('template.send')
  })

  it('marks all operations as mutations (write operations)', () => {
    const mutations = whatsappConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('media.send')
    expect(mutations).toContain('messages.send')
    expect(mutations).toContain('template.send')
  })
})
