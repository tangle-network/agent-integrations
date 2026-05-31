import { describe, expect, it } from 'vitest'
import { whatsscaleConnector, type ConnectorAdapter } from '../src/index'

describe('whatsscaleConnector', () => {
  it('declares correct manifest properties', () => {
    const manifest = whatsscaleConnector.manifest
    expect(manifest.kind).toBe('whatsscale')
    expect(manifest.displayName).toBe('WhatsScale')
    expect(manifest.category).toBe('comms')
    expect(manifest.auth.kind).toBe('api-key')
  })

  it('provides messaging and contact management capabilities', () => {
    const manifest = whatsscaleConnector.manifest
    const capabilityNames = manifest.capabilities.map((c) => c.name)

    expect(capabilityNames).toContain('contacts.create')
    expect(capabilityNames).toContain('contacts.get')
    expect(capabilityNames).toContain('contacts.list')
    expect(capabilityNames).toContain('contacts.addTag')
    expect(capabilityNames).toContain('messages.sendText')
    expect(capabilityNames).toContain('messages.sendImage')
    expect(capabilityNames).toContain('messages.sendVideo')
    expect(capabilityNames).toContain('messages.sendDocument')
  })

  it('marks message sends as mutations', () => {
    const manifest = whatsscaleConnector.manifest
    const sendTextCapability = manifest.capabilities.find((c) => c.name === 'messages.sendText')
    expect(sendTextCapability?.class).toBe('mutation')
  })

  it('marks contact queries as reads', () => {
    const manifest = whatsscaleConnector.manifest
    const listContactsCapability = manifest.capabilities.find((c) => c.name === 'contacts.list')
    expect(listContactsCapability?.class).toBe('read')
  })
})
