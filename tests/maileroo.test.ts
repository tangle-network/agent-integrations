import { describe, expect, it } from 'vitest'
import { mailerooConnector } from '../src/connectors/adapters/maileroo.js'

describe('maileroo adapter manifest', () => {
  it('classifies itself as the crm category and exposes the maileroo kind', () => {
    expect(mailerooConnector.manifest.kind).toBe('maileroo')
    expect(mailerooConnector.manifest.category).toBe('crm')
    expect(mailerooConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mailerooConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (sendEmail, sendFromTemplate, verifyEmail)', () => {
    const names = mailerooConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['email.send', 'email.send.template', 'email.verify'].sort())
    const reads = mailerooConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = mailerooConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['email.verify'])
    expect(mutations).toEqual(['email.send', 'email.send.template'].sort())
  })
})
