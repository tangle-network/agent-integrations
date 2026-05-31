import { describe, expect, it } from 'vitest'
import { azureOpenaiConnector } from '../src/connectors/adapters/azure-openai.js'

describe('azure-openai adapter manifest', () => {
  it('exposes the azure-openai kind, "other" category, and advisory consistency', () => {
    expect(azureOpenaiConnector.manifest.kind).toBe('azure-openai')
    expect(azureOpenaiConnector.manifest.category).toBe('other')
    expect(azureOpenaiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('matches the catalog auth shape (api-key) with a per-resource key hint', () => {
    const auth = azureOpenaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/azure/i)
    expect(auth.hint).toMatch(/key/i)
  })

  it('covers the catalog ask.gpt action (chat completions) plus the full Azure OpenAI surface', () => {
    const names = azureOpenaiConnector.manifest.capabilities.map((c) => c.name)
    // The catalog action `askGpt` maps to the chat completions surface; we
    // expose the full deployment-scoped capability, not a narrow "ask" wrapper.
    expect(names).toContain('chat.completions.create')
    expect(names).toContain('completions.create')
    expect(names).toContain('embeddings.create')
    expect(names).toContain('deployments.list')
  })

  it('classes reads vs mutations correctly', () => {
    const reads = azureOpenaiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = azureOpenaiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(reads).toContain('deployments.list')
    expect(reads).toContain('deployments.get')
    expect(reads).toContain('models.list')
    expect(mutations).toContain('chat.completions.create')
    expect(mutations).toContain('embeddings.create')
    expect(mutations).toContain('images.generate')
    expect(mutations).toContain('audio.speech.create')
  })

  it('marks generative mutations as native-idempotency (server treats each call as new)', () => {
    const byName = new Map(azureOpenaiConnector.manifest.capabilities.map((c) => [c.name, c]))
    const chat = byName.get('chat.completions.create')
    const embeddings = byName.get('embeddings.create')
    if (!chat || chat.class !== 'mutation' || !embeddings || embeddings.class !== 'mutation') {
      throw new Error('expected mutation capabilities')
    }
    expect(chat.cas).toBe('native-idempotency')
    expect(embeddings.cas).toBe('native-idempotency')
  })
})
