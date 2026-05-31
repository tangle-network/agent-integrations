import { describe, expect, it } from 'vitest'
import { comfyicuConnector } from '../src/connectors/adapters/comfyicu.js'

describe('comfyicu adapter manifest', () => {
  it('classifies itself as the other category and exposes the comfyicu kind', () => {
    expect(comfyicuConnector.manifest.kind).toBe('comfyicu')
    expect(comfyicuConnector.manifest.category).toBe('other')
    expect(comfyicuConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = comfyicuConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: list workflows + run status + run output + submit run', () => {
    const names = comfyicuConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['get.run.output', 'get.run.status', 'list.workflows', 'submit.workflow.run'].sort(),
    )
    const reads = comfyicuConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = comfyicuConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.run.output', 'get.run.status', 'list.workflows'])
    expect(mutations).toEqual(['submit.workflow.run'])
  })
})
