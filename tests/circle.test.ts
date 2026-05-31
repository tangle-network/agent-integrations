import { describe, expect, it } from 'vitest'
import { circleConnector } from '../src/connectors/adapters/circle.js'

describe('circle adapter manifest', () => {
  it('classifies itself as the comms category and exposes the circle kind', () => {
    expect(circleConnector.manifest.kind).toBe('circle')
    expect(circleConnector.manifest.category).toBe('comms')
    expect(circleConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = circleConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: post/comment/member creates plus member and post lookups', () => {
    const names = circleConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'posts.create',
        'comments.create',
        'spaces.add_member',
        'members.find_by_email',
        'posts.get',
        'members.get',
      ].sort(),
    )
    const reads = circleConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = circleConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['members.find_by_email', 'members.get', 'posts.get'])
    expect(mutations).toEqual(['comments.create', 'posts.create', 'spaces.add_member'])
  })
})
