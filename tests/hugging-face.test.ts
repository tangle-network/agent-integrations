import { describe, expect, it } from 'vitest'
import { huggingFaceConnector } from '../src/connectors/adapters/hugging-face.js'

describe('hugging-face adapter manifest', () => {
  it('exposes the hugging-face kind in the other category', () => {
    expect(huggingFaceConnector.manifest.kind).toBe('hugging-face')
    expect(huggingFaceConnector.manifest.category).toBe('other')
    expect(huggingFaceConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = huggingFaceConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (chat, summarization, translation, classification, document QA, image generation, detection)', () => {
    const names = huggingFaceConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'chat.completion',
        'create.image',
        'document.question.answering',
        'image.classification',
        'language.translation',
        'models.get',
        'models.search',
        'object.detection',
        'text.classification',
        'text.summarization',
      ].sort(),
    )
    const reads = huggingFaceConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = huggingFaceConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['models.get', 'models.search'].sort())
    expect(mutations).toEqual(
      [
        'chat.completion',
        'create.image',
        'document.question.answering',
        'image.classification',
        'language.translation',
        'object.detection',
        'text.classification',
        'text.summarization',
      ].sort(),
    )
  })
})
