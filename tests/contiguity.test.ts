import { describe, expect, it } from 'vitest'
import { contiguityConnector } from '../src/connectors/adapters/contiguity.js'

describe('contiguity adapter manifest', () => {
  it('classifies itself as the crm category and exposes the contiguity kind', () => {
    expect(contiguityConnector.manifest.kind).toBe('contiguity')
    expect(contiguityConnector.manifest.category).toBe('crm')
    expect(contiguityConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = contiguityConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (send text and send iMessage)', () => {
    const names = contiguityConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['messages.send_imessage', 'messages.send_text'].sort())
    const mutations = contiguityConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['messages.send_imessage', 'messages.send_text'].sort())
  })
})
