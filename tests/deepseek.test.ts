import { describe, expect, it } from 'vitest'
import { deepseekConnector } from '../src/connectors/adapters/deepseek.js'

describe('deepseek adapter manifest', () => {
  it('classifies itself as the other category and exposes the deepseek kind', () => {
    expect(deepseekConnector.manifest.kind).toBe('deepseek')
    expect(deepseekConnector.manifest.category).toBe('other')
    expect(deepseekConnector.manifest.defaultConsistencyModel).toBe('cache')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = deepseekConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/DeepSeek/i)
  })

  it('exposes the ask.deepseek action mirroring the activepieces catalog', () => {
    const names = deepseekConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('ask.deepseek')
    const ask = deepseekConnector.manifest.capabilities.find((c) => c.name === 'ask.deepseek')
    expect(ask?.class).toBe('mutation')
  })
})
