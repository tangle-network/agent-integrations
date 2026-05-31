import { describe, expect, it } from 'vitest'
import { smartsuiteConnector } from '../src/connectors/adapters/smartsuite.js'

describe('smartsuite adapter manifest', () => {
  it('classifies itself as the doc category and exposes the smartsuite kind', () => {
    expect(smartsuiteConnector.manifest.kind).toBe('smartsuite')
    expect(smartsuiteConnector.manifest.category).toBe('doc')
    expect(smartsuiteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = smartsuiteConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/SmartSuite/i)
  })

  it('covers record and file operation capability surface', () => {
    const names = smartsuiteConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'files.upload',
        'records.create',
        'records.delete',
        'records.find',
        'records.get',
        'records.update',
      ].sort(),
    )
    const mutations = smartsuiteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'files.upload',
        'records.create',
        'records.delete',
        'records.update',
      ].sort(),
    )
  })
})
