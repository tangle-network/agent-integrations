import { describe, expect, it } from 'vitest'
import { omnihrConnector } from '../src/connectors/adapters/omnihr.js'

describe('omnihr adapter manifest', () => {
  it('classifies itself as the crm category and exposes the omnihr kind', () => {
    expect(omnihrConnector.manifest.kind).toBe('omnihr')
    expect(omnihrConnector.manifest.category).toBe('crm')
    expect(omnihrConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = omnihrConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (employees system id, info, organizational chart, direct reports)', () => {
    const names = omnihrConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'employees.get.system.id',
        'employees.get.info',
        'employees.get.organizational.chart',
        'employees.get.direct.reports',
      ].sort(),
    )
    const reads = omnihrConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'employees.get.system.id',
        'employees.get.info',
        'employees.get.organizational.chart',
        'employees.get.direct.reports',
      ].sort(),
    )
  })
})
