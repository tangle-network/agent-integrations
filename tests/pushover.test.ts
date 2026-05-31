import { describe, expect, it } from 'vitest'
import { pushoverConnector } from '../src/connectors/adapters/pushover.js'

describe('pushover adapter manifest', () => {
  it('classifies itself as the comms category and exposes the pushover kind', () => {
    expect(pushoverConnector.manifest.kind).toBe('pushover')
    expect(pushoverConnector.manifest.category).toBe('comms')
    expect(pushoverConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = pushoverConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Pushover/i)
  })

  it('covers notifications.send capability surface', () => {
    const names = pushoverConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['notifications.send'].sort())
    const mutations = pushoverConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['notifications.send'].sort())
  })
})
