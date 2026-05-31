import { describe, expect, it } from 'vitest'
import { notionConnector } from '../src/connectors/adapters/notion.js'

describe('notion adapter manifest', () => {
  it('classifies itself as the doc category and exposes the notion kind', () => {
    expect(notionConnector.manifest.kind).toBe('notion')
    expect(notionConnector.manifest.category).toBe('doc')
    expect(notionConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = notionConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the full activepieces action set (databases, pages, blocks, comments)', () => {
    const names = notionConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'databases.retrieve',
        'databases.query',
        'pages.create',
        'pages.retrieve',
        'pages.update',
        'pages.archive',
        'blocks.retrieve',
        'blocks.children',
        'blocks.append',
        'comments.create',
        'comments.retrieve',
      ].sort(),
    )
    const reads = notionConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = notionConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      [
        'databases.retrieve',
        'databases.query',
        'pages.retrieve',
        'blocks.retrieve',
        'blocks.children',
        'comments.retrieve',
      ].sort(),
    )
    expect(mutations).toEqual(
      [
        'pages.create',
        'pages.update',
        'pages.archive',
        'blocks.append',
        'comments.create',
      ].sort(),
    )
  })
})
