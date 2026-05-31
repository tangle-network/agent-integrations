import { describe, expect, it } from 'vitest'
import { insightlyConnector } from '../src/connectors/adapters/insightly.js'

describe('insightly adapter manifest', () => {
  it('classifies itself as the crm category and exposes the insightly kind', () => {
    expect(insightlyConnector.manifest.kind).toBe('insightly')
    expect(insightlyConnector.manifest.category).toBe('crm')
    expect(insightlyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = insightlyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: create / update / get / delete / find record', () => {
    const names = insightlyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      expect.arrayContaining([
        'records.create',
        'records.update',
        'records.get',
        'records.delete',
        'records.find',
      ]),
    )
    const mutations = insightlyConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(mutations).toEqual(
      expect.arrayContaining(['records.create', 'records.update', 'records.delete']),
    )
    for (const cap of insightlyConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.externalEffect).toBe(true)
        expect(['native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
