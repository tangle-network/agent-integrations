import { describe, expect, it } from 'vitest'
import { foreplayCoConnector } from '../src/connectors/adapters/foreplay-co.js'

describe('foreplay-co adapter manifest', () => {
  it('exposes the foreplay-co kind under the crm category with authoritative consistency', () => {
    expect(foreplayCoConnector.manifest.kind).toBe('foreplay-co')
    expect(foreplayCoConnector.manifest.category).toBe('crm')
    expect(foreplayCoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(foreplayCoConnector.manifest.displayName).toBe('Foreplay')
  })

  it('uses api-key auth matching the activepieces catalog entry', () => {
    const auth = foreplayCoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint.toLowerCase()).toContain('api key')
  })

  it('covers discovery, ads, brands, swipe files, and Spyder tracking', () => {
    const names = foreplayCoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'discovery.search',
        'ads.get',
        'brands.search',
        'brands.get',
        'brands.ads.list',
        'swipeFiles.list',
        'swipeFiles.get',
        'swipeFiles.ads.list',
        'swipeFiles.create',
        'swipeFiles.ads.add',
        'swipeFiles.ads.remove',
        'spyder.brands.list',
        'spyder.brands.add',
        'spyder.brands.remove',
        'spyder.ads.list',
      ].sort(),
    )
  })

  it('declares CAS strategies on every mutation', () => {
    for (const cap of foreplayCoConnector.manifest.capabilities) {
      if (cap.class === 'mutation') {
        expect(cap.cas).toBeDefined()
        expect(['etag-if-match', 'native-idempotency', 'optimistic-read-verify', 'none']).toContain(cap.cas)
      }
    }
  })
})
