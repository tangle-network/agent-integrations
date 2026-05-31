import { describe, expect, it } from 'vitest'
import { raiaAiConnector } from '../src/connectors/adapters/raia-ai.js'

describe('raia-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the raia-ai kind', () => {
    expect(raiaAiConnector.manifest.kind).toBe('raia-ai')
    expect(raiaAiConnector.manifest.category).toBe('other')
    expect(raiaAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = raiaAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Raia/i)
  })

  it('covers agent prompt and file upload capability surface', () => {
    const names = raiaAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['agent.file.upload', 'agent.prompt'].sort())
    const mutations = raiaAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['agent.file.upload', 'agent.prompt'].sort())
  })
})
