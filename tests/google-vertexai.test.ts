import { describe, expect, it } from 'vitest'
import { googleVertexaiConnector } from '../src/connectors/adapters/google-vertexai.js'

describe('google-vertexai adapter manifest', () => {
  it('classifies itself as the other category and exposes the google-vertexai kind', () => {
    expect(googleVertexaiConnector.manifest.kind).toBe('google-vertexai')
    expect(googleVertexaiConnector.manifest.category).toBe('other')
    expect(googleVertexaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = googleVertexaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Google Cloud/i)
  })

  it('covers content generation, image generation, and model listing capabilities', () => {
    const names = googleVertexaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('content.generate')
    expect(names).toContain('content.generateWithFiles')
    expect(names).toContain('image.generate')
    expect(names).toContain('models.list')
    expect(names).toContain('content.countTokens')
  })

  it('exposes read and mutation capability classes', () => {
    const capabilities = googleVertexaiConnector.manifest.capabilities
    const readCapabilities = capabilities.filter((c) => c.class === 'read').map((c) => c.name)
    const mutationCapabilities = capabilities.filter((c) => c.class === 'mutation').map((c) => c.name)
    expect(readCapabilities.length).toBeGreaterThan(0)
    expect(mutationCapabilities.length).toBeGreaterThan(0)
    expect(mutationCapabilities).toContain('image.generate')
  })
})
