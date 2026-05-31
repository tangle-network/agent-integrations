import { describe, expect, it } from 'vitest'
import { telnyxConnector } from '../src/connectors/adapters/telnyx.js'

describe('telnyx adapter manifest', () => {
  it('classifies itself as the comms category and exposes the telnyx kind', () => {
    expect(telnyxConnector.manifest.kind).toBe('telnyx')
    expect(telnyxConnector.manifest.category).toBe('comms')
    expect(telnyxConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Telnyx-specific hint', () => {
    const auth = telnyxConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Telnyx/i)
  })

  it('covers messages and calls capability surface', () => {
    const names = telnyxConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('messages.send')
    expect(names).toContain('calls.create')
    expect(names).toContain('calls.list')
    expect(names).toContain('calls.get')
    expect(names).toContain('messages.list')
  })

  it('marks SMS and call initiation as mutations', () => {
    const mutations = telnyxConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('messages.send')
    expect(mutations).toContain('calls.create')
  })

  it('marks read-only operations as read', () => {
    const reads = telnyxConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('calls.list')
    expect(reads).toContain('calls.get')
    expect(reads).toContain('messages.list')
  })
})
