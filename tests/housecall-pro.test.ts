import { describe, expect, it } from 'vitest'
import { housecallProConnector } from '../src/connectors/adapters/housecall-pro.js'

describe('housecall-pro adapter manifest', () => {
  it('classifies itself as the crm category and exposes the housecall-pro kind', () => {
    expect(housecallProConnector.manifest.kind).toBe('housecall-pro')
    expect(housecallProConnector.manifest.category).toBe('crm')
    expect(housecallProConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = housecallProConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers customer, job, lead, line-item, attachment, note, and tag surfaces', () => {
    const names = housecallProConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'customers.search',
        'customers.get',
        'customers.create',
        'customers.update',
        'customers.addresses.create',
        'jobs.search',
        'jobs.get',
        'jobs.update',
        'jobs.line_items.create',
        'jobs.notes.create',
        'jobs.attachments.create',
        'jobs.tags.add',
        'leads.search',
        'leads.get',
        'leads.convert',
      ].sort(),
    )
    const reads = housecallProConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = housecallProConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['customers.get', 'customers.search', 'jobs.get', 'jobs.search', 'leads.get', 'leads.search'].sort(),
    )
    expect(mutations).toEqual(
      [
        'customers.addresses.create',
        'customers.create',
        'customers.update',
        'jobs.attachments.create',
        'jobs.line_items.create',
        'jobs.notes.create',
        'jobs.tags.add',
        'jobs.update',
        'leads.convert',
      ].sort(),
    )
  })
})
