import { describe, expect, it } from 'vitest'
import { echowinConnector } from '../src/connectors/adapters/echowin.js'

describe('echowin adapter manifest', () => {
  it('classifies itself as the crm category and exposes the echowin kind', () => {
    expect(echowinConnector.manifest.kind).toBe('echowin')
    expect(echowinConnector.manifest.category).toBe('crm')
    expect(echowinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = echowinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Echowin/i)
  })

  it('covers the contacts capability surface', () => {
    const names = echowinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['contacts.create', 'contacts.delete', 'contacts.find'].sort())
  })
})
