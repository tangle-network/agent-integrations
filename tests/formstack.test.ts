import { describe, expect, it } from 'vitest'
import { formstackConnector } from '../src/connectors/adapters/formstack.js'

describe('formstack adapter manifest', () => {
  it('classifies itself with the formstack kind and an authoritative consistency model', () => {
    expect(formstackConnector.manifest.kind).toBe('formstack')
    expect(formstackConnector.manifest.category).toBe('other')
    expect(formstackConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses oauth2 auth (mirrors the activepieces piece auth shape)', () => {
    const auth = formstackConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/formstack\.com/)
    expect(auth.tokenUrl).toMatch(/formstack\.com/)
    expect(auth.scopes).toEqual(expect.arrayContaining(['read', 'write']))
  })

  it('covers the catalog action set (create submission, find form, get submission, search submissions)', () => {
    const names = formstackConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['forms.find', 'forms.get', 'submissions.create', 'submissions.get', 'submissions.search'].sort(),
    )
    const reads = formstackConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = formstackConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['forms.find', 'forms.get', 'submissions.get', 'submissions.search'].sort())
    expect(mutations).toEqual(['submissions.create'].sort())
  })
})
