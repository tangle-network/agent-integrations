import { describe, expect, it } from 'vitest'
import { brilliantDirectoriesConnector } from '../src/connectors/adapters/brilliant-directories.js'

describe('brilliant-directories adapter manifest', () => {
  it('classifies itself as the crm category and exposes the brilliant-directories kind', () => {
    expect(brilliantDirectoriesConnector.manifest.kind).toBe('brilliant-directories')
    expect(brilliantDirectoriesConnector.manifest.category).toBe('crm')
    expect(brilliantDirectoriesConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = brilliantDirectoriesConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: create new user', () => {
    const names = brilliantDirectoriesConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['users.create'])
    const mutations = brilliantDirectoriesConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['users.create'])
  })
})
