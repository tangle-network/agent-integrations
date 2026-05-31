import { describe, expect, it } from 'vitest'
import { microsoftOnenoteConnector } from '../src/connectors/adapters/microsoft-onenote.js'

describe('microsoft-onenote adapter manifest', () => {
  it('classifies itself as the doc category and exposes the microsoft-onenote kind', () => {
    expect(microsoftOnenoteConnector.manifest.kind).toBe('microsoft-onenote')
    expect(microsoftOnenoteConnector.manifest.category).toBe('doc')
    expect(microsoftOnenoteConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = microsoftOnenoteConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the activepieces action set (append/create-image/create-in-section/create-notebook/create-page/create-section)', () => {
    const mutations = microsoftOnenoteConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'notebooks.create',
        'pages.append',
        'pages.create',
        'pages.createImage',
        'pages.createInSection',
        'sections.create',
      ].sort(),
    )
  })
})
