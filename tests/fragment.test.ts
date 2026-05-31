import { describe, expect, it } from 'vitest'
import { fragmentConnector } from '../src/connectors/adapters/fragment.js'

describe('fragment adapter manifest', () => {
  it('classifies itself as the other category and exposes the fragment kind', () => {
    expect(fragmentConnector.manifest.kind).toBe('fragment')
    expect(fragmentConnector.manifest.category).toBe('other')
    expect(fragmentConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = fragmentConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (task CRUD + list)', () => {
    const names = fragmentConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'tasks.create',
        'tasks.update',
        'tasks.get',
        'tasks.list',
        'tasks.delete',
      ].sort(),
    )
    const reads = fragmentConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = fragmentConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['tasks.get', 'tasks.list'].sort())
    expect(mutations).toEqual(['tasks.create', 'tasks.delete', 'tasks.update'].sort())
  })
})
