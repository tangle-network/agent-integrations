import { describe, expect, it } from 'vitest'
import { voucheryIoConnector } from '../src/connectors/adapters/vouchery-io.js'

describe('vouchery-io adapter manifest', () => {
  it('classifies itself as the workflow category and exposes the vouchery-io kind', () => {
    expect(voucheryIoConnector.manifest.kind).toBe('vouchery-io')
    expect(voucheryIoConnector.manifest.category).toBe('commerce')
    expect(voucheryIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = voucheryIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (find voucher, create customer, create avoucher)', () => {
    const names = voucheryIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'vouchers.find',
        'customers.create',
        'vouchers.create',
      ].sort(),
    )
    const reads = voucheryIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = voucheryIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['vouchers.find'].sort())
    expect(mutations).toEqual(
      [
        'customers.create',
        'vouchers.create',
      ].sort(),
    )
  })
})
