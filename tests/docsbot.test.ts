import { describe, expect, it } from 'vitest'
import { docsbotConnector } from '../src/connectors/adapters/docsbot.js'

describe('docsbot adapter manifest', () => {
  it('classifies itself as the other category and exposes the docsbot kind', () => {
    expect(docsbotConnector.manifest.kind).toBe('docsbot')
    expect(docsbotConnector.manifest.category).toBe('other')
    expect(docsbotConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth', () => {
    const auth = docsbotConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (bots, sources, conversations)', () => {
    const names = docsbotConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'bots.find',
        'bots.create',
        'sources.create',
        'sources.upload',
        'conversations.ask',
      ].sort(),
    )
    const reads = docsbotConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = docsbotConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['bots.find', 'conversations.ask'].sort())
    expect(mutations).toEqual(['bots.create', 'sources.create', 'sources.upload'].sort())
  })
})
