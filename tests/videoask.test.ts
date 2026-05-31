import { describe, expect, it } from 'vitest'
import { videoaskConnector } from '../src/connectors/adapters/videoask.js'

describe('videoask adapter manifest', () => {
  it('classifies itself as the other category and exposes the videoask kind', () => {
    expect(videoaskConnector.manifest.kind).toBe('videoask')
    expect(videoaskConnector.manifest.category).toBe('other')
    expect(videoaskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = videoaskConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (contacts, forms, responses)', () => {
    const names = videoaskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.tags.add',
        'contacts.tags.remove',
        'forms.search',
        'forms.get',
        'responses.list',
      ].sort(),
    )
    const reads = videoaskConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = videoaskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['forms.search', 'forms.get', 'responses.list'].sort(),
    )
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.update',
        'contacts.tags.add',
        'contacts.tags.remove',
      ].sort(),
    )
  })
})
