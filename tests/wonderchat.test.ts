import { describe, expect, it } from 'vitest'
import { wonderchatConnector } from '../src/connectors/adapters/wonderchat.js'

describe('wonderchat adapter manifest', () => {
  it('classifies itself as the other category and exposes the wonderchat kind', () => {
    expect(wonderchatConnector.manifest.kind).toBe('wonderchat')
    expect(wonderchatConnector.manifest.category).toBe('other')
    expect(wonderchatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = wonderchatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (ask, page, tag operations)', () => {
    const names = wonderchatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'question.ask',
        'page.add',
        'tag.add',
        'tag.remove',
      ].sort(),
    )
    const reads = wonderchatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = wonderchatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['question.ask'].sort())
    expect(mutations).toEqual(['page.add', 'tag.add', 'tag.remove'].sort())
  })
})
