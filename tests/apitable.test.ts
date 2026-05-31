import { describe, expect, it } from 'vitest'
import { apitableConnector } from '../src/connectors/adapters/apitable.js'

describe('apitable adapter manifest', () => {
  it('classifies itself as the spreadsheet category and exposes the apitable kind', () => {
    expect(apitableConnector.manifest.kind).toBe('apitable')
    expect(apitableConnector.manifest.category).toBe('spreadsheet')
    expect(apitableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = apitableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: find/create/update record', () => {
    const names = apitableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['records.create', 'records.find', 'records.update'])

    const reads = apitableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = apitableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.find'])
    expect(mutations).toEqual(['records.create', 'records.update'])
  })
})
