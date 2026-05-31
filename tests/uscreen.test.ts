import { describe, expect, it } from 'vitest'
import { uscreenConnector } from '../src/connectors/adapters/uscreen.js'

describe('uscreen adapter manifest', () => {
  it('classifies itself as the crm category and exposes the uscreen kind', () => {
    expect(uscreenConnector.manifest.kind).toBe('uscreen')
    expect(uscreenConnector.manifest.category).toBe('crm')
    expect(uscreenConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Uscreen-specific hint', () => {
    const auth = uscreenConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Uscreen/i)
  })

  it('covers users and access management capabilities', () => {
    const names = uscreenConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('users.create')
    expect(names).toContain('access.assign')
  })

  it('marks destructive operations as mutations', () => {
    const mutations = uscreenConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('users.create')
    expect(mutations).toContain('access.assign')
  })
})
