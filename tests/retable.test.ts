import { describe, expect, it } from 'vitest'
import { retableConnector } from '../src/connectors/adapters/retable.js'

describe('retable adapter manifest', () => {
  it('classifies itself as the doc category and exposes the retable kind', () => {
    expect(retableConnector.manifest.kind).toBe('retable')
    expect(retableConnector.manifest.category).toBe('doc')
    expect(retableConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = retableConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (workspaces, projects, retables, records)', () => {
    const names = retableConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workspaces.list',
        'workspaces.create',
        'projects.list',
        'projects.create',
        'retables.list',
        'records.create',
        'records.get',
        'records.list',
        'records.update',
      ].sort(),
    )
    const reads = retableConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = retableConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['workspaces.list', 'projects.list', 'retables.list', 'records.get', 'records.list'].sort(),
    )
    expect(mutations).toEqual(
      ['workspaces.create', 'projects.create', 'records.create', 'records.update'].sort(),
    )
  })
})
