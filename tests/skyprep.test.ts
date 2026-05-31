import { describe, expect, it } from 'vitest'
import { skyprepConnector } from '../src/connectors/adapters/skyprep.js'

describe('skyprep adapter manifest', () => {
  it('classifies itself as the other category and exposes the skyprep kind', () => {
    expect(skyprepConnector.manifest.kind).toBe('skyprep')
    expect(skyprepConnector.manifest.category).toBe('other')
    expect(skyprepConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = skyprepConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (user enrollment and updates)', () => {
    const names = skyprepConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'users.enroll.into.course',
        'users.enroll.into.group',
        'users.update',
      ].sort(),
    )
    const mutations = skyprepConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'users.enroll.into.course',
        'users.enroll.into.group',
        'users.update',
      ].sort(),
    )
  })
})
