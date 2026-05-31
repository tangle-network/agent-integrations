import { describe, expect, it } from 'vitest'
import { descriptConnector } from '../src/connectors/adapters/descript.js'

describe('descript adapter manifest', () => {
  it('classifies itself as the storage category and exposes the descript kind', () => {
    expect(descriptConnector.manifest.kind).toBe('descript')
    expect(descriptConnector.manifest.category).toBe('storage')
    expect(descriptConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = descriptConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (projects, jobs, agent edit, media import, publish)', () => {
    const names = descriptConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'projects.list',
        'projects.get',
        'jobs.get',
        'agent.edit',
        'media.import',
        'project.publish',
      ].sort(),
    )
    const reads = descriptConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = descriptConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['jobs.get', 'projects.get', 'projects.list'].sort())
    expect(mutations).toEqual(['agent.edit', 'media.import', 'project.publish'].sort())
  })
})
