import { describe, expect, it } from 'vitest'
import { zeplinConnector } from '../src/connectors/adapters/zeplin.js'

describe('zeplin adapter manifest', () => {
  it('classifies itself as the other category and exposes the zeplin kind', () => {
    expect(zeplinConnector.manifest.kind).toBe('zeplin')
    expect(zeplinConnector.manifest.category).toBe('other')
    expect(zeplinConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = zeplinConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (projects, screens, notes)', () => {
    const names = zeplinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'projects.search',
        'projects.update',
        'screens.search',
        'screens.update',
        'notes.create',
      ].sort(),
    )
    const reads = zeplinConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = zeplinConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['projects.search', 'screens.search'].sort())
    expect(mutations).toEqual(['projects.update', 'screens.update', 'notes.create'].sort())
  })
})
