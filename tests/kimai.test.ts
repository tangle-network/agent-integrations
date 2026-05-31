import { describe, expect, it } from 'vitest'
import { kimaiConnector } from '../src/connectors/adapters/kimai.js'

describe('kimai adapter manifest', () => {
  it('exposes the kimai kind and a stable consistency model for timesheet writes', () => {
    expect(kimaiConnector.manifest.kind).toBe('kimai')
    expect(kimaiConnector.manifest.category).toBe('other')
    expect(kimaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = kimaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (timesheet create)', () => {
    const names = kimaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['timesheets.create'])
    const mutations = kimaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['timesheets.create'])
  })
})
