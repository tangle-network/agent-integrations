import { describe, expect, it } from 'vitest'
import { youcanbookmeConnector } from '../src/connectors/adapters/youcanbookme.js'

describe('youcanbookme adapter manifest', () => {
  it('classifies itself as the crm category and exposes the youcanbookme kind', () => {
    expect(youcanbookmeConnector.manifest.kind).toBe('youcanbookme')
    expect(youcanbookmeConnector.manifest.category).toBe('crm')
    expect(youcanbookmeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = youcanbookmeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (profiles.create, bookings.retrieve)', () => {
    const names = youcanbookmeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['profiles.create', 'bookings.retrieve'].sort(),
    )
    const reads = youcanbookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = youcanbookmeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['bookings.retrieve'])
    expect(mutations).toEqual(['profiles.create'])
  })
})
