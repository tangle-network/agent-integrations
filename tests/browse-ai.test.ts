import { describe, expect, it } from 'vitest'
import { browseAiConnector } from '../src/connectors/adapters/browse-ai.js'

describe('browse-ai adapter manifest', () => {
  it('exposes the browse-ai kind and other category', () => {
    expect(browseAiConnector.manifest.kind).toBe('browse-ai')
    expect(browseAiConnector.manifest.category).toBe('other')
    expect(browseAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = browseAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the three actions declared by the activepieces piece', () => {
    const names = browseAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['get.task.details', 'list.robots', 'run.robot'])
    const reads = browseAiConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = browseAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.task.details', 'list.robots'])
    expect(mutations).toEqual(['run.robot'])
  })
})
