import { describe, expect, it } from 'vitest'
import { jinaAiConnector } from '../src/connectors/adapters/jina-ai.js'

describe('jina-ai adapter manifest', () => {
  it('exposes the jina-ai kind under the catalog workflow category as "other"', () => {
    // The activepieces catalog records jina-ai under category "workflow", which
    // the connector taxonomy folds into the generic "other" bucket (no first-
    // class workflow category in ConnectorAdapter.manifest.category).
    expect(jinaAiConnector.manifest.kind).toBe('jina-ai')
    expect(jinaAiConnector.manifest.category).toBe('other')
    expect(jinaAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = jinaAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers Jinas public surface: reader, search, classify+train, embed, rerank, deepsearch, model discovery', () => {
    const names = jinaAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'classifier.classify',
        'classifier.train',
        'deepsearch.chat',
        'embeddings.create',
        'models.list',
        'reader.read',
        'reranker.rerank',
        'search.query',
      ].sort(),
    )

    const reads = jinaAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = jinaAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['models.list', 'reader.read', 'search.query'])
    expect(mutations).toEqual(
      [
        'classifier.classify',
        'classifier.train',
        'deepsearch.chat',
        'embeddings.create',
        'reranker.rerank',
      ].sort(),
    )
  })
})
