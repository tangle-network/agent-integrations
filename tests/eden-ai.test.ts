import { describe, expect, it } from 'vitest'
import { edenAiConnector } from '../src/connectors/adapters/eden-ai.js'

describe('eden-ai adapter manifest', () => {
  it('exposes the eden-ai kind, "other" category, and advisory consistency', () => {
    expect(edenAiConnector.manifest.kind).toBe('eden-ai')
    expect(edenAiConnector.manifest.category).toBe('other')
    expect(edenAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (eden-ai has no public OAuth surface)', () => {
    const auth = edenAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers all 13 catalog actions across text / ocr / image / audio surfaces', () => {
    const names = edenAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'generate.text',
        'summarize.text',
        'extract.keywords',
        'detect.language',
        'extract.entities',
        'moderate.text',
        'spell.check',
        'translate.text',
        'invoice.parser',
        'receipt.parser',
        'ocr.image',
        'image.generation',
        'text.to.speech',
      ].sort(),
    )
  })

  it('marks every generation/aggregation call as cas="none" (provider replay is not idempotent)', () => {
    for (const cap of edenAiConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') throw new Error(`expected mutation, got ${cap.class} for ${cap.name}`)
      expect(cap.cas).toBe('none')
      expect(cap.externalEffect).toBe(true)
    }
  })
})
