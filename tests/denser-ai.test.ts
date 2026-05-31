import { describe, expect, it } from 'vitest'
import { denserAiConnector } from '../src/connectors/adapters/denser-ai.js'

describe('denser-ai adapter manifest', () => {
  it('classifies itself under the other category and exposes the denser-ai kind', () => {
    expect(denserAiConnector.manifest.kind).toBe('denser-ai')
    expect(denserAiConnector.manifest.category).toBe('other')
    expect(denserAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (Denser.ai has no OAuth flow)', () => {
    const auth = denserAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the process.input.text capability from the activepieces catalog', () => {
    const names = denserAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['process.input.text'])
    const action = denserAiConnector.manifest.capabilities.find((c) => c.name === 'process.input.text')
    if (!action) throw new Error('process.input.text capability missing')
    expect(action.class).toBe('mutation')
  })
})
