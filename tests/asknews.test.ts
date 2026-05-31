import { describe, expect, it } from 'vitest'
import { asknewsConnector } from '../src/connectors/adapters/asknews.js'

describe('asknews adapter manifest', () => {
  it('classifies itself as the crm category and exposes the asknews kind', () => {
    expect(asknewsConnector.manifest.kind).toBe('asknews')
    expect(asknewsConnector.manifest.category).toBe('crm')
    expect(asknewsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = asknewsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action and trigger set: search, graph, article fetch, chat, stories, newsletters, alerts', () => {
    const names = asknewsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'search.news',
        'generate.news.knowledge.graph',
        'get.article.by.id',
        'asknews.chat.completion',
        'search.stories',
        'create.anewsletter',
        'update.anewsletter',
        'alert.for.query',
      ].sort(),
    )
    const reads = asknewsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = asknewsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.article.by.id', 'search.news', 'search.stories'])
    expect(mutations).toEqual(
      [
        'alert.for.query',
        'asknews.chat.completion',
        'create.anewsletter',
        'generate.news.knowledge.graph',
        'update.anewsletter',
      ].sort(),
    )
  })
})
