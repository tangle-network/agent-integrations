import { describe, expect, it } from 'vitest'
import { instaChartsConnector } from '../src/connectors/adapters/insta-charts.js'

describe('insta-charts adapter manifest', () => {
  it('classifies itself as the crm category and exposes the insta-charts kind', () => {
    expect(instaChartsConnector.manifest.kind).toBe('insta-charts')
    expect(instaChartsConnector.manifest.category).toBe('crm')
    expect(instaChartsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = instaChartsConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: chart generation', () => {
    const names = instaChartsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['chart.generate'])
    const mutations = instaChartsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['chart.generate'])
  })
})
