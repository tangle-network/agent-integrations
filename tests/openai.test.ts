import { describe, expect, it } from 'vitest'
import { openaiConnector } from '../src/connectors/adapters/openai.js'

describe('openai adapter manifest', () => {
  it('classifies itself as the other category and exposes the openai kind', () => {
    expect(openaiConnector.manifest.kind).toBe('openai')
    expect(openaiConnector.manifest.displayName).toBe('OpenAI')
    expect(openaiConnector.manifest.category).toBe('other')
    expect(openaiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth (OpenAI Platform issues long-lived bearer secret keys, not OAuth)', () => {
    const auth = openaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('exhaustiveness check')
    expect(auth.hint).toMatch(/platform\.openai\.com\/api-keys/)
  })

  it('covers models discovery, chat + responses, embeddings, images, audio, moderations, files, fine-tuning, and batch', () => {
    const names = openaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'models.list',
        'models.get',
        'chat.completions.create',
        'responses.create',
        'responses.get',
        'responses.delete',
        'responses.cancel',
        'embeddings.create',
        'images.generate',
        'audio.speech.create',
        'moderations.create',
        'files.list',
        'files.get',
        'files.delete',
        'fineTuning.jobs.list',
        'fineTuning.jobs.get',
        'fineTuning.jobs.create',
        'fineTuning.jobs.cancel',
        'batches.create',
        'batches.get',
        'batches.list',
        'batches.cancel',
      ].sort(),
    )

    const reads = openaiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = openaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()

    // reads = the pure GET surface; everything POSTed (even stateless completions) is a mutation
    expect(reads).toContain('models.list')
    expect(reads).toContain('models.get')
    expect(reads).toContain('files.list')
    expect(reads).toContain('files.get')
    expect(reads).toContain('responses.get')
    expect(reads).toContain('fineTuning.jobs.list')
    expect(reads).toContain('fineTuning.jobs.get')
    expect(reads).toContain('batches.list')
    expect(reads).toContain('batches.get')

    expect(mutations).toContain('chat.completions.create')
    expect(mutations).toContain('responses.create')
    expect(mutations).toContain('embeddings.create')
    expect(mutations).toContain('images.generate')
    expect(mutations).toContain('audio.speech.create')
    expect(mutations).toContain('moderations.create')
    expect(mutations).toContain('files.delete')
    expect(mutations).toContain('fineTuning.jobs.create')
    expect(mutations).toContain('fineTuning.jobs.cancel')
    expect(mutations).toContain('batches.create')
    expect(mutations).toContain('batches.cancel')
  })

  it('marks every mutation native-idempotency (POST is stateless; dedup is the caller MutationGuard concern)', () => {
    const mutations = openaiConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(mutations.length).toBeGreaterThan(0)
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('typing guard')
      expect(m.cas).toBe('native-idempotency')
    }
  })
})
