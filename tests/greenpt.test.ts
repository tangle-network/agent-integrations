import { describe, expect, it } from 'vitest'
import { greenptConnector } from '../src/connectors/adapters/greenpt.js'

describe('greenpt adapter manifest', () => {
  it('exposes the greenpt kind and the other category', () => {
    expect(greenptConnector.manifest.kind).toBe('greenpt')
    expect(greenptConnector.manifest.category).toBe('other')
    expect(greenptConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = greenptConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (chat, embeddings, transcription)', () => {
    const names = greenptConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['chat.completion', 'create.embeddings', 'transcribe.audio'].sort())
    const mutations = greenptConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['chat.completion', 'create.embeddings', 'transcribe.audio'].sort())
  })
})
