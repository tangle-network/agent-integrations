import { describe, expect, it } from 'vitest'
import { amazonSecretsManagerConnector } from '../src/connectors/adapters/amazon-secrets-manager.js'

describe('amazon-secrets-manager adapter manifest', () => {
  it('exposes the amazon-secrets-manager kind and other category', () => {
    expect(amazonSecretsManagerConnector.manifest.kind).toBe('amazon-secrets-manager')
    expect(amazonSecretsManagerConnector.manifest.category).toBe('other')
    expect(amazonSecretsManagerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = amazonSecretsManagerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (get, find, create, update, delete, random-password)', () => {
    const names = amazonSecretsManagerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'secrets.get',
        'secrets.find',
        'secrets.password.random',
        'secrets.create',
        'secrets.update',
        'secrets.delete',
      ].sort(),
    )
    const reads = amazonSecretsManagerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = amazonSecretsManagerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['secrets.find', 'secrets.get', 'secrets.password.random'].sort())
    expect(mutations).toEqual(['secrets.create', 'secrets.delete', 'secrets.update'].sort())
  })
})
