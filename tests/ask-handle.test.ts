import { describe, expect, it } from 'vitest'
import { askHandleConnector } from '../src/connectors/adapters/ask-handle.js'

describe('ask-handle adapter manifest', () => {
  it('classifies itself as the other category and exposes the ask-handle kind', () => {
    expect(askHandleConnector.manifest.kind).toBe('ask-handle')
    expect(askHandleConnector.manifest.category).toBe('other')
    expect(askHandleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = askHandleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: messages, leads, and rooms', () => {
    const names = askHandleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['leads.create', 'leads.list', 'messages.create', 'rooms.list'])
    const mutations = askHandleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['leads.create', 'messages.create'])
  })
})
