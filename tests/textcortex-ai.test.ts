import { describe, expect, it } from 'vitest'
import { textcortexAiConnector } from '../src/connectors/adapters/textcortex-ai.js'

describe('textcortex-ai adapter manifest', () => {
  it('classifies itself as the comms category and exposes the textcortex-ai kind', () => {
    expect(textcortexAiConnector.manifest.kind).toBe('textcortex-ai')
    expect(textcortexAiConnector.manifest.category).toBe('comms')
    expect(textcortexAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = textcortexAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/TextCortex/i)
  })

  it('covers prompt, paraphrase, social, translation, code, email, product, and summary capabilities', () => {
    const names = textcortexAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'code.create',
        'email.create',
        'paraphrase.create',
        'product.description.create',
        'prompt.send',
        'social.media.caption.create',
        'summary.create',
        'translation.create',
      ].sort(),
    )
    const mutations = textcortexAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations.length).toBe(8)
    expect(mutations).toEqual(names)
  })
})
