import { describe, expect, it } from 'vitest'
import { azureOpenaiConnector } from '../src/connectors/adapters/azure-openai.js'

describe('azure-openai adapter manifest', () => {
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
