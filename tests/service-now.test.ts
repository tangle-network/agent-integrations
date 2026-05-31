import { describe, expect, it } from 'vitest'
import { serviceNowConnector } from '../src/connectors/adapters/service-now.js'

describe('service-now adapter manifest', () => {
  it('classifies itself as the doc category and exposes the service-now kind', () => {
    expect(serviceNowConnector.manifest.kind).toBe('service-now')
    expect(serviceNowConnector.manifest.category).toBe('doc')
    expect(serviceNowConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = serviceNowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/ServiceNow/i)
  })

  it('covers records, attachments, comments, and incidents capability surface', () => {
    const names = serviceNowConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'attachments.add',
        'attachments.delete',
        'attachments.find',
        'comments.add',
        'incidents.resolve',
        'records.count',
        'records.create',
        'records.delete',
        'records.find',
        'records.get',
        'records.update',
      ].sort(),
    )
    const mutations = serviceNowConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'attachments.add',
        'attachments.delete',
        'comments.add',
        'incidents.resolve',
        'records.create',
        'records.delete',
        'records.update',
      ].sort(),
    )
  })
})
