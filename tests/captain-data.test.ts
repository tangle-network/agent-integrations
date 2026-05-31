import { describe, expect, it } from 'vitest'
import { captainDataConnector } from '../src/connectors/adapters/captain-data.js'

describe('captain-data adapter manifest', () => {
  it('classifies itself as the workflow-style "other" category and exposes the captain-data kind', () => {
    expect(captainDataConnector.manifest.kind).toBe('captain-data')
    expect(captainDataConnector.manifest.category).toBe('other')
    expect(captainDataConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = captainDataConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: launch workflow and read job results', () => {
    const names = captainDataConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['getJobResults', 'launchWorkflow'])

    const reads = captainDataConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = captainDataConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['getJobResults'])
    expect(mutations).toEqual(['launchWorkflow'])
  })
})
