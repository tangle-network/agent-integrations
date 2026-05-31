import { describe, expect, it } from 'vitest'
import { kudosityConnector } from '../src/connectors/adapters/kudosity.js'

describe('kudosity adapter manifest', () => {
  it('classifies itself as the comms category and exposes the kudosity kind', () => {
    expect(kudosityConnector.manifest.kind).toBe('kudosity')
    expect(kudosityConnector.manifest.category).toBe('comms')
    expect(kudosityConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = kudosityConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts + SMS lifecycle + number format)', () => {
    const names = kudosityConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contact.add.update',
        'contact.delete',
        'sms.send',
        'sms.cancel',
        'sms.info.get',
        'number.format',
      ].sort(),
    )
    const reads = kudosityConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = kudosityConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['number.format', 'sms.info.get'].sort())
    expect(mutations).toEqual(
      ['contact.add.update', 'contact.delete', 'sms.cancel', 'sms.send'].sort(),
    )
  })
})
