import { describe, expect, it } from 'vitest'
import { chainAwareConnector } from '../src/connectors/adapters/chain-aware.js'

describe('chain-aware adapter manifest', () => {
  it('classifies itself as the other category and exposes the chain-aware kind', () => {
    expect(chainAwareConnector.manifest.kind).toBe('chain-aware')
    expect(chainAwareConnector.manifest.category).toBe('other')
    expect(chainAwareConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = chainAwareConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: wallet analysis operations', () => {
    const names = chainAwareConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'wallet.audit',
      'wallet.creditScore',
      'wallet.fraudCheck',
      'wallet.rugPullCheck',
      'wallet.segment',
    ])
    const reads = chainAwareConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([
      'wallet.audit',
      'wallet.creditScore',
      'wallet.fraudCheck',
      'wallet.rugPullCheck',
      'wallet.segment',
    ])
  })
})
