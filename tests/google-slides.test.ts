import { describe, expect, it } from 'vitest'
import { googleSlidesConnector } from '../src/connectors/adapters/google-slides.js'

describe('google-slides adapter manifest', () => {
  it('classifies itself as the doc category and exposes the google-slides kind', () => {
    expect(googleSlidesConnector.manifest.kind).toBe('google-slides')
    expect(googleSlidesConnector.manifest.category).toBe('doc')
    expect(googleSlidesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = googleSlidesConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: get, create, and refresh charts', () => {
    const names = googleSlidesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['charts.refresh', 'presentation.create', 'presentation.get'])
    const mutations = googleSlidesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['charts.refresh', 'presentation.create'])
  })
})
