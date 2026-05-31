import { describe, expect, it } from 'vitest'
import { amazonSesConnector } from '../src/connectors/adapters/amazon-ses.js'

describe('amazon-ses adapter manifest', () => {
  it('classifies itself as the comms category and exposes the amazon-ses kind', () => {
    expect(amazonSesConnector.manifest.kind).toBe('amazon-ses')
    expect(amazonSesConnector.manifest.category).toBe('comms')
    expect(amazonSesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = amazonSesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (send email, templates, custom verification)', () => {
    const names = amazonSesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'send.email',
        'send.templated.email',
        'create.email.template',
        'update.email.template',
        'create.custom.verification.email.template',
        'update.custom.verification.email.template',
        'send.custom.verification.email',
      ].sort(),
    )
    const reads = amazonSesConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonSesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual([])
    expect(mutations).toEqual(
      [
        'send.email',
        'send.templated.email',
        'create.email.template',
        'update.email.template',
        'create.custom.verification.email.template',
        'update.custom.verification.email.template',
        'send.custom.verification.email',
      ].sort(),
    )
  })
})
