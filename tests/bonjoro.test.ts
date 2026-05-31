import { describe, expect, it } from 'vitest'
import { bonjoroConnector } from '../src/connectors/adapters/bonjoro.js'

describe('bonjoro adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bonjoro kind', () => {
    expect(bonjoroConnector.manifest.kind).toBe('bonjoro')
    expect(bonjoroConnector.manifest.category).toBe('crm')
    expect(bonjoroConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = bonjoroConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the add-greet mutation from the catalog action set', () => {
    const names = bonjoroConnector.manifest.capabilities.map((c) => c.name)
    expect(names).toContain('greets.add')
    const greet = bonjoroConnector.manifest.capabilities.find((c) => c.name === 'greets.add')
    expect(greet?.class).toBe('mutation')
  })
})
