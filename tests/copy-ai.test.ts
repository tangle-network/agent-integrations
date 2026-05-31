import { describe, expect, it } from 'vitest'
import { copyAiConnector } from '../src/connectors/adapters/copy-ai.js'

describe('copy-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the copy-ai kind', () => {
    expect(copyAiConnector.manifest.kind).toBe('copy-ai')
    expect(copyAiConnector.manifest.category).toBe('other')
    expect(copyAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = copyAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: run workflow + status + outputs reads', () => {
    const names = copyAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['workflow.run', 'workflow.run.outputs', 'workflow.run.status'].sort(),
    )
    const reads = copyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = copyAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['workflow.run.outputs', 'workflow.run.status'])
    expect(mutations).toEqual(['workflow.run'])
  })
})
