import { describe, expect, it } from 'vitest'
import { pushbulletConnector } from '../src/connectors/adapters/pushbullet.js'

describe('pushbullet adapter manifest', () => {
  it('classifies itself as the comms category and exposes the pushbullet kind', () => {
    expect(pushbulletConnector.manifest.kind).toBe('pushbullet')
    expect(pushbulletConnector.manifest.category).toBe('comms')
    expect(pushbulletConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth as documented in the catalog', () => {
    const auth = pushbulletConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
  })

  it('covers the catalog action set: sending links and notes', () => {
    const names = pushbulletConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['notifications.sendLink', 'notifications.sendNote'])
    const mutations = pushbulletConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['notifications.sendLink', 'notifications.sendNote'])
  })
})
