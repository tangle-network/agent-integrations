import { describe, expect, it } from 'vitest'
import { llmrailsConnector } from '../src/connectors/adapters/llmrails.js'

describe('llmrails adapter manifest', () => {
  it('exposes the llmrails kind and a category compatible with the connector schema', () => {
    expect(llmrailsConnector.manifest.kind).toBe('llmrails')
    // Catalog labels llmrails as "workflow", which is not a valid value in
    // the connector category enum. The adapter falls back to `other`, which
    // is the schema-valid representation for unclassified RAG/AI surfaces.
    expect(llmrailsConnector.manifest.category).toBe('other')
    expect(llmrailsConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = llmrailsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: datastore.search', () => {
    const names = llmrailsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['datastore.search'])
    const reads = llmrailsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['datastore.search'])
  })
})
