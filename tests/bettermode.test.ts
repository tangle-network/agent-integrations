import { describe, expect, it } from 'vitest'
import { bettermodeConnector } from '../src/connectors/adapters/bettermode.js'

describe('bettermode adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bettermode kind', () => {
    expect(bettermodeConnector.manifest.kind).toBe('bettermode')
    expect(bettermodeConnector.manifest.category).toBe('crm')
    expect(bettermodeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = bettermodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (assign/revoke badge, create discussion/question)', () => {
    const names = bettermodeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['badge.assign', 'badge.revoke', 'discussion.create', 'question.create'].sort(),
    )
    const mutations = bettermodeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['badge.assign', 'badge.revoke', 'discussion.create', 'question.create'].sort(),
    )
  })
})
