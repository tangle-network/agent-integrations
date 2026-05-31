import { describe, expect, it } from 'vitest'
import { chaindeskConnector } from '../src/connectors/adapters/chaindesk.js'

describe('chaindesk adapter manifest', () => {
  it('classifies itself as the other category and exposes the chaindesk kind', () => {
    expect(chaindeskConnector.manifest.kind).toBe('chaindesk')
    expect(chaindeskConnector.manifest.category).toBe('other')
    expect(chaindeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = chaindeskConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: query agent, query datasource, and upload file', () => {
    const names = chaindeskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['agents.query', 'datasources.query', 'files.upload'])
    const mutations = chaindeskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['files.upload'])
  })
})
