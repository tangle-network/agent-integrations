import { describe, expect, it } from 'vitest'
import { mailercheckConnector } from '../src/connectors/adapters/mailercheck.js'

describe('mailercheck adapter manifest', () => {
  it('classifies itself as the crm category and exposes the mailercheck kind', () => {
    expect(mailercheckConnector.manifest.kind).toBe('mailercheck')
    expect(mailercheckConnector.manifest.category).toBe('crm')
    expect(mailercheckConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = mailercheckConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces verify-email-address action', () => {
    const names = mailercheckConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['verify.an.email.address'])
    const mutations = mailercheckConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['verify.an.email.address'])
  })
})
