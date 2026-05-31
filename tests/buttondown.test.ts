import { describe, expect, it } from 'vitest'
import { buttondownConnector } from '../src/connectors/adapters/buttondown.js'

describe('buttondown adapter manifest', () => {
  it('classifies itself as the crm category and exposes the buttondown kind', () => {
    expect(buttondownConnector.manifest.kind).toBe('buttondown')
    expect(buttondownConnector.manifest.category).toBe('crm')
    expect(buttondownConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = buttondownConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Buttondown/i)
  })

  it('covers subscribers and email sending capability surface', () => {
    const names = buttondownConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.create',
        'subscribers.list',
        'subscribers.send_email',
      ].sort(),
    )
    const mutations = buttondownConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['subscribers.create', 'subscribers.send_email'].sort(),
    )
  })
})
