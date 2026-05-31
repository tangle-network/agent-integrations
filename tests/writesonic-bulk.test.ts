import { describe, expect, it } from 'vitest'
import { writesonicBulkConnector } from '../src/connectors/adapters/writesonic-bulk.js'

describe('writesonic-bulk adapter manifest', () => {
  it('classifies itself as the doc category and exposes the writesonic-bulk kind', () => {
    expect(writesonicBulkConnector.manifest.kind).toBe('writesonic-bulk')
    expect(writesonicBulkConnector.manifest.category).toBe('doc')
    expect(writesonicBulkConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a Writesonic-specific hint', () => {
    const auth = writesonicBulkConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Writesonic/i)
  })

  it('covers blog, content, ads, and product description generation capabilities', () => {
    const names = writesonicBulkConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('blog.ideas')
    expect(names).toContain('blog.intros')
    expect(names).toContain('blog.outlines')
    expect(names).toContain('content.rephraser')
    expect(names).toContain('content.shorten')
    expect(names).toContain('sentence.expander')
    expect(names).toContain('facebook.ads')
    expect(names).toContain('google.ads')
    expect(names).toContain('generate.product.descriptions')
    expect(names).toContain('landing.page.headlines')
  })

  it('marks all content generation operations as mutations', () => {
    const mutations = writesonicBulkConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('blog.ideas')
    expect(mutations).toContain('blog.intros')
    expect(mutations).toContain('blog.outlines')
    expect(mutations).toContain('content.rephraser')
    expect(mutations).toContain('content.shorten')
    expect(mutations).toContain('sentence.expander')
    expect(mutations).toContain('facebook.ads')
    expect(mutations).toContain('google.ads')
    expect(mutations).toContain('generate.product.descriptions')
    expect(mutations).toContain('landing.page.headlines')
  })
})
