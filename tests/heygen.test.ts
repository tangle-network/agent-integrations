import { describe, expect, it } from 'vitest'
import { heygenConnector } from '../src/connectors/adapters/heygen.js'

describe('heygen adapter manifest', () => {
  it('exposes the heygen kind, "other" category, and advisory consistency', () => {
    expect(heygenConnector.manifest.kind).toBe('heygen')
    expect(heygenConnector.manifest.category).toBe('other')
    expect(heygenConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('uses api-key auth (heygen has no public OAuth surface)', () => {
    const auth = heygenConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/api key/i)
  })

  it('covers template generation, status polling, translation, sharing, listing, and asset upload', () => {
    const names = heygenConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'videos.createFromTemplate',
        'videos.status',
        'videos.translateStatus',
        'videos.shareUrl',
        'videos.list',
        'videos.translate',
        'avatars.list',
        'voices.list',
        'assets.upload',
      ].sort(),
    )
    const reads = heygenConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = heygenConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['avatars.list', 'videos.list', 'videos.shareUrl', 'videos.status', 'videos.translateStatus', 'voices.list'].sort(),
    )
    expect(mutations).toEqual(['assets.upload', 'videos.createFromTemplate', 'videos.translate'].sort())
  })

  it('marks asset upload as cas="none" and async render submissions as native-idempotency', () => {
    const byName = new Map(heygenConnector.manifest.capabilities.map((c) => [c.name, c]))
    const assetUpload = byName.get('assets.upload')
    const createFromTemplate = byName.get('videos.createFromTemplate')
    const translate = byName.get('videos.translate')
    if (
      !assetUpload ||
      assetUpload.class !== 'mutation' ||
      !createFromTemplate ||
      createFromTemplate.class !== 'mutation' ||
      !translate ||
      translate.class !== 'mutation'
    ) {
      throw new Error('expected mutation capabilities')
    }
    expect(assetUpload.cas).toBe('none')
    expect(createFromTemplate.cas).toBe('native-idempotency')
    expect(translate.cas).toBe('native-idempotency')
  })
})
