import { describe, expect, it } from 'vitest'
import { detectingAiConnector } from '../src/connectors/adapters/detecting-ai.js'

describe('detecting-ai adapter manifest', () => {
  it('classifies itself as other category and exposes the detecting-ai kind', () => {
    expect(detectingAiConnector.manifest.kind).toBe('detecting-ai')
    expect(detectingAiConnector.manifest.category).toBe('other')
    expect(detectingAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = detectingAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Detecting.AI/i)
  })

  it('covers detect, plagiarism, and humanize capability surface', () => {
    const names = detectingAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['content.detect-ai', 'plagiarism.check', 'text.humanize'].sort(),
    )
    const mutations = detectingAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['text.humanize'])
  })
})
