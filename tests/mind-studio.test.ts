import { describe, expect, it } from 'vitest'
import { mindStudioConnector } from '../src/connectors/adapters/mind-studio.js'

describe('mind-studio adapter manifest', () => {
  it('classifies itself as the other category and exposes the mind-studio kind', () => {
    expect(mindStudioConnector.manifest.kind).toBe('mind-studio')
    expect(mindStudioConnector.manifest.category).toBe('other')
    expect(mindStudioConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = mindStudioConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/MindStudio/i)
  })

  it('covers the workflows.run capability surface', () => {
    const names = mindStudioConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['workflows.run'].sort())
    const mutations = mindStudioConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['workflows.run'].sort())
  })
})
