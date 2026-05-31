import { describe, expect, it } from 'vitest'
import { reoonVerifierConnector } from '../src/connectors/adapters/reoon-verifier.js'

describe('reoon-verifier adapter manifest', () => {
  it('classifies itself as the crm category and exposes the reoon-verifier kind', () => {
    expect(reoonVerifierConnector.manifest.kind).toBe('reoon-verifier')
    expect(reoonVerifierConnector.manifest.category).toBe('crm')
    expect(reoonVerifierConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = reoonVerifierConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Reoon/i)
  })

  it('covers verify.email, bulk.email.verification, and bulk.verification.result capabilities', () => {
    const names = reoonVerifierConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'verify.email',
        'bulk.email.verification',
        'bulk.verification.result',
      ].sort(),
    )
    const mutations = reoonVerifierConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['bulk.email.verification'].sort())
  })
})
