import { describe, expect, it } from 'vitest'
import { geminiConnector } from '../src/connectors/adapters/gemini.js'

describe('gemini adapter manifest', () => {
  it('identifies as the gemini kind with api-key auth and "other" category', () => {
    expect(geminiConnector.manifest.kind).toBe('gemini')
    expect(geminiConnector.manifest.displayName).toBe('Google Gemini')
    expect(geminiConnector.manifest.category).toBe('other')
    expect(geminiConnector.manifest.defaultConsistencyModel).toBe('cache')
    expect(geminiConnector.manifest.auth.kind).toBe('api-key')
  })

  it('exposes generation, embeddings, files, and context-cache capabilities', () => {
    const names = geminiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'models.get',
        'models.countTokens',
        'models.generateContent',
        'models.streamGenerateContent',
        'models.embedContent',
        'models.batchEmbedContents',
        'files.list',
        'files.get',
        'files.delete',
        'cachedContents.list',
        'cachedContents.get',
        'cachedContents.create',
        'cachedContents.delete',
      ].sort(),
    )
  })

  it('classifies billed generation/embedding as mutations with externalEffect=true', () => {
    const byName = new Map(geminiConnector.manifest.capabilities.map((c) => [c.name, c]))
    for (const name of [
      'models.generateContent',
      'models.streamGenerateContent',
      'models.embedContent',
      'models.batchEmbedContents',
    ]) {
      const cap = byName.get(name)
      if (cap?.class !== 'mutation') throw new Error(`${name} should be a mutation`)
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('classifies discovery/inspection as reads with no upstream effect', () => {
    const reads = geminiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['cachedContents.get', 'cachedContents.list', 'files.get', 'files.list', 'models.countTokens', 'models.get', 'models.list'].sort(),
    )
  })
})
