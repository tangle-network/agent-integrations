import { describe, expect, it } from 'vitest'
import { microsoftDynamicsCrmConnector } from '../src/connectors/adapters/microsoft-dynamics-crm.js'

describe('microsoft-dynamics-crm adapter manifest', () => {
  it('classifies itself as the crm category and exposes the microsoft-dynamics-crm kind', () => {
    expect(microsoftDynamicsCrmConnector.manifest.kind).toBe('microsoft-dynamics-crm')
    expect(microsoftDynamicsCrmConnector.manifest.category).toBe('crm')
    expect(microsoftDynamicsCrmConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = microsoftDynamicsCrmConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (create/get/update/delete record)', () => {
    const names = microsoftDynamicsCrmConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['records.create', 'records.delete', 'records.get', 'records.update'].sort(),
    )
    const reads = microsoftDynamicsCrmConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = microsoftDynamicsCrmConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.get'])
    expect(mutations).toEqual(['records.create', 'records.delete', 'records.update'].sort())
  })
})
