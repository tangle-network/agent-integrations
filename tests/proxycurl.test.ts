import { describe, expect, it } from 'vitest'
import { proxycurlConnector } from '../src/connectors/adapters/proxycurl.js'

describe('proxycurl adapter manifest', () => {
  it('classifies itself as the crm category and exposes the proxycurl kind', () => {
    expect(proxycurlConnector.manifest.kind).toBe('proxycurl')
    expect(proxycurlConnector.manifest.category).toBe('crm')
    expect(proxycurlConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = proxycurlConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (person profile, company profile, search people, lookup email)', () => {
    const names = proxycurlConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'person.profile.get',
        'company.profile.get',
        'people.search',
        'person.email.lookup',
      ].sort(),
    )
    const reads = proxycurlConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'person.profile.get',
        'company.profile.get',
        'people.search',
        'person.email.lookup',
      ].sort(),
    )
  })
})
