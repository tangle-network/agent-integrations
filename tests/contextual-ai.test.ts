import { describe, expect, it } from 'vitest'
import { contextualAiConnector } from '../src/connectors/adapters/contextual-ai.js'

describe('contextual-ai adapter manifest', () => {
  it('classifies itself as the doc category and exposes the contextual-ai kind', () => {
    expect(contextualAiConnector.manifest.kind).toBe('contextual-ai')
    expect(contextualAiConnector.manifest.category).toBe('doc')
    expect(contextualAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = contextualAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Contextual AI/i)
  })

  it('covers agent query, generation, document ingestion, parsing, agent creation, user invites, and datastore creation', () => {
    const names = contextualAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'query.agent',
        'generate',
        'ingest.document',
        'parse.file',
        'create.agent',
        'invite.users',
        'create.datastore',
      ].sort(),
    )
    const mutations = contextualAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['generate', 'ingest.document', 'parse.file', 'create.agent', 'invite.users', 'create.datastore'].sort(),
    )
  })
})
