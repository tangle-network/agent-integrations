import { describe, expect, it } from 'vitest'
import { gptzeroDetectAiConnector } from '../src/connectors/adapters/gptzero-detect-ai.js'

describe('gptzero-detect-ai adapter manifest', () => {
  it('classifies itself as the other category and exposes the gptzero-detect-ai kind', () => {
    expect(gptzeroDetectAiConnector.manifest.kind).toBe('gptzero-detect-ai')
    expect(gptzeroDetectAiConnector.manifest.category).toBe('other')
    expect(gptzeroDetectAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = gptzeroDetectAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: scan text and scan file', () => {
    const names = gptzeroDetectAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['scan.file', 'scan.text'])
    const mutations = gptzeroDetectAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['scan.file', 'scan.text'])
  })
})
