import { describe, expect, it } from 'vitest'
import { imageRouterConnector } from '../src/connectors/adapters/image-router.js'

describe('image-router adapter manifest', () => {
  it('declares the image-router kind and the other category', () => {
    expect(imageRouterConnector.manifest.kind).toBe('image-router')
    // The activepieces catalog labels image-router as category "workflow",
    // which is not one of the connector-platform categories — every AI
    // generation surface maps to "other" until a dedicated bucket exists.
    expect(imageRouterConnector.manifest.category).toBe('other')
    expect(imageRouterConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = imageRouterConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the two write actions declared by the activepieces piece', () => {
    const names = imageRouterConnector.manifest.capabilities.map((c) => c.name).sort()
    // models.list is an additional read probe; createImage + imageToImage
    // are the two upstream actions ("createImage" / "imageToImage").
    expect(names).toEqual(['createImage', 'imageToImage', 'models.list'].sort())

    const mutations = imageRouterConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['createImage', 'imageToImage'].sort())

    const reads = imageRouterConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toEqual(['models.list'])
  })
})
