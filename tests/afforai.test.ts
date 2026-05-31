import { describe, expect, it } from 'vitest'
import { afforaiConnector } from '../src/connectors/adapters/afforai.js'

describe('afforai adapter manifest', () => {
  it('classifies itself under the other category and exposes the afforai kind', () => {
    expect(afforaiConnector.manifest.kind).toBe('afforai')
    expect(afforaiConnector.manifest.category).toBe('other')
    expect(afforaiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (Afforai has no OAuth flow)', () => {
    const auth = afforaiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the ask.chatbot capability from the activepieces catalog', () => {
    const names = afforaiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['ask.chatbot'])
    const ask = afforaiConnector.manifest.capabilities.find((c) => c.name === 'ask.chatbot')
    if (!ask) throw new Error('ask.chatbot capability missing')
    expect(ask.class).toBe('mutation')
  })
})
