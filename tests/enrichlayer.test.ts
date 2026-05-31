import { describe, expect, it } from 'vitest'
import { enrichlayerConnector } from '../src/connectors/adapters/enrichlayer.js'

describe('enrichlayer adapter manifest', () => {
  it('classifies itself as the crm category and exposes the enrichlayer kind', () => {
    expect(enrichlayerConnector.manifest.kind).toBe('enrichlayer')
    expect(enrichlayerConnector.manifest.category).toBe('crm')
    expect(enrichlayerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = enrichlayerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set as read-class capabilities', () => {
    const names = enrichlayerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'school.profile.get',
        'company.profile.get',
        'person.profile.get',
        'company.lookup',
        'company.id.lookup',
        'company.picture.get',
        'person.picture.get',
        'employee.listing',
        'employee.count',
        'employee.search',
        'person.lookup',
        'role.lookup',
        'reverse.email.lookup',
        'reverse.phone.lookup',
        'work.email.lookup',
        'personal.contact.lookup',
        'personal.email.lookup',
        'disposable.email.check',
        'student.listing',
        'job.profile.get',
        'job.search',
        'job.count',
        'company.search',
        'person.search',
        'credit.balance.get',
      ].sort(),
    )
    // The activepieces piece exposes 25 read-class enrichment lookups; no
    // mutating actions exist on this surface.
    const classes = new Set(enrichlayerConnector.manifest.capabilities.map((c) => c.class))
    expect(classes).toEqual(new Set(['read']))
    expect(enrichlayerConnector.manifest.capabilities).toHaveLength(25)
  })
})
