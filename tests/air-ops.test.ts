import { describe, expect, it } from 'vitest'
import { airOpsConnector } from '../src/connectors/adapters/air-ops.js'

describe('air-ops adapter manifest', () => {
  it('classifies itself as other and exposes the air-ops kind', () => {
    expect(airOpsConnector.manifest.kind).toBe('air-ops')
    expect(airOpsConnector.manifest.category).toBe('other')
    expect(airOpsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth as the catalog declares', () => {
    const auth = airOpsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AirOps/i)
  })

  it('covers the run / async-run / get-execution actions from the catalog', () => {
    const names = airOpsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['get.execution', 'run.workflow', 'run.workflow.async'])
    const reads = airOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = airOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.execution'])
    expect(mutations).toEqual(['run.workflow', 'run.workflow.async'])
  })
})
