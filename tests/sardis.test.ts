import { describe, expect, it } from 'vitest'
import { sardisConnector } from '../src/connectors/adapters/sardis.js'

describe('sardis adapter manifest', () => {
  it('classifies itself as the crm category and exposes the sardis kind', () => {
    expect(sardisConnector.manifest.kind).toBe('sardis')
    expect(sardisConnector.manifest.category).toBe('crm')
    expect(sardisConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = sardisConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Sardis/i)
  })

  it('covers payment, balance, policy, and transaction capability surface', () => {
    const names = sardisConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'balance.check',
        'payment.send',
        'policy.check',
        'policy.set',
        'transactions.list',
      ].sort(),
    )
    const mutations = sardisConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'payment.send',
        'policy.set',
      ].sort(),
    )
  })
})
