import { describe, expect, it } from 'vitest'
import { claudeConnector } from '../src/connectors/adapters/claude.js'

describe('claude adapter manifest', () => {
  it('classifies itself as the other category and exposes the claude kind', () => {
    expect(claudeConnector.manifest.kind).toBe('claude')
    expect(claudeConnector.manifest.category).toBe('other')
    expect(claudeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = claudeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Anthropic/i)
  })

  it('covers the ask and extract.structured.data capability surface', () => {
    const names = claudeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['ask.claude', 'extract.structured.data'].sort())
  })
})
