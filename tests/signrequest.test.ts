import { describe, expect, it } from 'vitest'
import { signrequestConnector } from '../src/connectors/adapters/signrequest.js'

describe('signrequest adapter manifest', () => {
  it('classifies itself as the crm category and exposes the signrequest kind', () => {
    expect(signrequestConnector.manifest.kind).toBe('signrequest')
    expect(signrequestConnector.manifest.category).toBe('crm')
    expect(signrequestConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = signrequestConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set and additional operations', () => {
    const names = signrequestConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      ['requests.send', 'requests.list', 'requests.get', 'requests.cancel', 'teams.get'].sort(),
    )
    const reads = signrequestConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = signrequestConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['requests.get', 'requests.list', 'teams.get'].sort())
    expect(mutations).toEqual(['requests.send', 'requests.cancel'].sort())
  })
})
