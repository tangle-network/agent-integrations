import { describe, expect, it } from 'vitest'
import { azureOpenaiConnector } from '../src/connectors/adapters/azure-openai.js'

describe('azure-openai adapter manifest', () => {
  it('matches the catalog auth shape (api-key) with a per-resource key hint', () => {
    const auth = azureOpenaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/azure/i)
    expect(auth.hint).toMatch(/key/i)
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
