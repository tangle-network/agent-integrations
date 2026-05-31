import { describe, expect, it } from 'vitest'
import { cognitoFormsConnector } from '../src/connectors/adapters/cognito-forms.js'

describe('cognito-forms adapter manifest', () => {
  it('exposes the cognito-forms kind in the other category', () => {
    expect(cognitoFormsConnector.manifest.kind).toBe('cognito-forms')
    expect(cognitoFormsConnector.manifest.category).toBe('other')
    expect(cognitoFormsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = cognitoFormsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set (entry create/update/delete/get)', () => {
    const names = cognitoFormsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['entries.create', 'entries.update', 'entries.delete', 'entries.get'].sort(),
    )
    const reads = cognitoFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = cognitoFormsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['entries.get'])
    expect(mutations).toEqual(['entries.create', 'entries.delete', 'entries.update'])
  })
})
