import { describe, expect, it } from 'vitest'
import { esignaturesConnector } from '../src/connectors/adapters/esignatures.js'

describe('esignatures adapter manifest', () => {
  it('classifies itself as the crm category and exposes the esignatures kind', () => {
    expect(esignaturesConnector.manifest.kind).toBe('esignatures')
    expect(esignaturesConnector.manifest.category).toBe('crm')
    expect(esignaturesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = esignaturesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (create.contract)', () => {
    const names = esignaturesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['create.contract'].sort())
    const mutations = esignaturesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['create.contract'].sort())
  })
})
