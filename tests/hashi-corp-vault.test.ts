import { describe, expect, it } from 'vitest'
import { hashiCorpVaultConnector } from '../src/connectors/adapters/hashi-corp-vault.js'

describe('hashi-corp-vault adapter manifest', () => {
  it('exposes the hashi-corp-vault kind and other category', () => {
    expect(hashiCorpVaultConnector.manifest.kind).toBe('hashi-corp-vault')
    expect(hashiCorpVaultConnector.manifest.category).toBe('other')
    expect(hashiCorpVaultConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = hashiCorpVaultConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (read, write, delete, list)', () => {
    const names = hashiCorpVaultConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['secrets.delete', 'secrets.list', 'secrets.read', 'secrets.write'].sort())
    const reads = hashiCorpVaultConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = hashiCorpVaultConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['secrets.list', 'secrets.read'].sort())
    expect(mutations).toEqual(['secrets.delete', 'secrets.write'].sort())
  })
})
