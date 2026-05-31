import { describe, expect, it } from 'vitest'
import { mailgunConnector } from '../src/connectors/adapters/mailgun.js'

describe('mailgun adapter manifest', () => {
  it('classifies itself as the comms category and exposes the mailgun kind', () => {
    expect(mailgunConnector.manifest.kind).toBe('mailgun')
    expect(mailgunConnector.manifest.category).toBe('comms')
    expect(mailgunConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = mailgunConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: send, validate, list member, events, stats, bounces', () => {
    const names = mailgunConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'messages.send',
        'email.validate',
        'mailing_list.member.add',
        'events.list',
        'domain.stats',
        'bounces.list',
      ].sort(),
    )
    const reads = mailgunConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mailgunConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['bounces.list', 'domain.stats', 'events.list'])
    expect(mutations).toEqual(['email.validate', 'mailing_list.member.add', 'messages.send'].sort())
  })
})
