import { describe, expect, it } from 'vitest'
import { sendpulseConnector } from '../src/connectors/adapters/sendpulse.js'

describe('sendpulse adapter manifest', () => {
  it('classifies itself as the comms category and exposes the sendpulse kind', () => {
    expect(sendpulseConnector.manifest.kind).toBe('sendpulse')
    expect(sendpulseConnector.manifest.category).toBe('comms')
    expect(sendpulseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with SendPulse oauth endpoints', () => {
    const auth = sendpulseConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://login.sendpulse.com/oauth/authorize')
    expect(auth.tokenUrl).toBe('https://api.sendpulse.com/oauth/access_token')
    expect(auth.clientIdEnv).toBe('SENDPULSE_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('SENDPULSE_CLIENT_SECRET')
  })

  it('covers subscriber and addressbook capability surface', () => {
    const names = sendpulseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'addressbooks.list',
      'subscriber.add',
      'subscriber.delete',
      'subscriber.get',
      'subscriber.unsubscribe',
      'subscriber.update',
      'subscriber.variable.update',
    ])
  })

  it('marks subscriber mutations with appropriate cas strategies', () => {
    const mutations = sendpulseConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .sort((a, b) => a.name.localeCompare(b.name))

    expect(mutations.length).toBe(5)

    const mutationMap = new Map(mutations.map((m) => [m.name, m]))

    expect(mutationMap.get('subscriber.add')?.cas).toBe('native-idempotency')
    expect(mutationMap.get('subscriber.update')?.cas).toBe('etag-if-match')
    expect(mutationMap.get('subscriber.delete')?.cas).toBe('optimistic-read-verify')
    expect(mutationMap.get('subscriber.unsubscribe')?.cas).toBe('optimistic-read-verify')
    expect(mutationMap.get('subscriber.variable.update')?.cas).toBe('optimistic-read-verify')
  })

  it('exposes read capabilities for addressbooks and subscriber retrieval', () => {
    const reads = sendpulseConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()

    expect(reads).toEqual(['addressbooks.list', 'subscriber.get'])
  })
})
