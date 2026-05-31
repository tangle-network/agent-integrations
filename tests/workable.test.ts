import { describe, expect, it } from 'vitest'
import { workableConnector } from '../src/connectors/adapters/workable.js'

describe('workable adapter manifest', () => {
  it('classifies itself as the crm category and exposes the workable kind', () => {
    expect(workableConnector.manifest.kind).toBe('workable')
    expect(workableConnector.manifest.category).toBe('crm')
    expect(workableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = workableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the main activepieces action set (candidates, jobs, stages, members)', () => {
    const names = workableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'candidates.get',
        'candidates.move',
        'candidates.rate',
        'candidates.comment',
        'jobs.get',
        'jobs.stages',
        'jobs.list',
        'members.list',
      ].sort(),
    )
    const reads = workableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = workableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['candidates.get', 'jobs.get', 'jobs.stages', 'jobs.list', 'members.list'].sort(),
    )
    expect(mutations).toEqual(['candidates.move', 'candidates.rate', 'candidates.comment'].sort())
  })
})
