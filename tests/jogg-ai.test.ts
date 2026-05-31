import { describe, expect, it } from 'vitest'
import { joggAiConnector } from '../src/connectors/adapters/jogg-ai.js'

describe('jogg-ai adapter manifest', () => {
  it('exposes the jogg-ai kind, "other" category, and authoritative consistency', () => {
    expect(joggAiConnector.manifest.kind).toBe('jogg-ai')
    // Activepieces catalog category is "workflow"; ConnectorManifest only
    // models a fixed enum (no "workflow") so it maps to the generic bucket.
    expect(joggAiConnector.manifest.category).toBe('other')
    expect(joggAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (catalog auth=api_key, header x-api-key)', () => {
    const auth = joggAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers every activepieces action: avatars, products, video poll, media, template', () => {
    const names = joggAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'avatar.photo.create',
        'avatar.video.create',
        'product.create.from_url',
        'product.create.from_info',
        'product.update',
        'video.get',
        'media.upload',
        'video.create.from_template',
      ].sort(),
    )
  })

  it('only video.get is a read; every generator/uploader is a mutation', () => {
    const reads = joggAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = joggAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['video.get'])
    expect(mutations).toEqual(
      [
        'avatar.photo.create',
        'avatar.video.create',
        'media.upload',
        'product.create.from_info',
        'product.create.from_url',
        'product.update',
        'video.create.from_template',
      ].sort(),
    )
  })
})
