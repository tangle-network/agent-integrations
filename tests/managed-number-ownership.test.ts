import { describe, it, expect } from 'vitest'
import { advanceManagedNumber, type InkboxIdentity, type ManagedNumberOrder, type ManagedNumberPorts } from '../src/managed-messaging/index.js'

function fixture() {
  let row: ManagedNumberOrder = { id: 'order1', ownerId: 'alice', handle: 'tng-order1', organizationId: 'org', transport: 'sms',
    fundingAuthorizationId: 'funding', version: 0, phase: 'number', attempted: false, status: 'pending', identityId: 'identity1' }
  let identity: InkboxIdentity = { id: 'identity1', handle: 'tng-order1', organizationId: 'org', status: 'active', imessageEnabled: false, sms: null, imessage: null }
  let purchases = 0, now = 1000000
  const ports: ManagedNumberPorts = {
    now: () => now,
    orders: { get: async () => structuredClone(row), saveIfVersion: async (next, version) => {
      if (row.version !== version) return false; row = structuredClone(next); return true
    } },
    canProvision: async () => true, authorizeFunding: async () => true,
    provider: {
      getIdentity: async () => structuredClone(identity),
      createIdentity: async () => { throw new Error('unexpected identity creation') },
      claimIMessage: async () => { throw new Error('unexpected iMessage claim') },
      provisionSms: async () => {
        purchases++; identity.sms = { id: 'line1', number: '+15551112222', smsStatus: 'ready', status: 'active' }; return { ...identity.sms }
      },
      mintIdentityKey: async () => { throw new Error('not reached before owned receipt') },
      verifyIdentityKey: async () => {},
    },
    vault: { read: async () => null, putIfAbsent: async () => {} },
    bindConnection: async () => { throw new Error('not reached before owned receipt') },
  }
  return { ports, tick: () => advanceManagedNumber('order1', ports), get row() { return row }, get purchases() { return purchases },
    foreignOwner: () => { identity.organizationId = 'foreign' }, advance: () => { now += 60000 } }
}

describe('billable SMS ownership receipts', () => {
  it.each(['id', 'number'] as const)('does not persist a mismatched purchased %s as billable', async field => {
    const f = fixture(), buy = f.ports.provider.provisionSms
    f.ports.provider.provisionSms = async (...args) => ({ ...await buy(...args), [field]: field === 'id' ? 'foreign-line' : '+15559998888' })
    await f.tick()
    expect(f.row.status).toBe('needs_review'); expect(f.row.number).toBeUndefined(); expect(f.purchases).toBe(1)
  })
  it('requires the identity owner to remain unchanged during purchase', async () => {
    const f = fixture(), buy = f.ports.provider.provisionSms
    f.ports.provider.provisionSms = async (...args) => { const number = await buy(...args); f.foreignOwner(); return number }
    await f.tick(); expect(f.row.status).toBe('needs_review'); expect(f.row.number).toBeUndefined()
  })
  it('reconciles a lost ownership read without purchasing again', async () => {
    const f = fixture(), read = f.ports.provider.getIdentity
    let fail = true
    f.ports.provider.getIdentity = async handle => {
      if (f.purchases && fail) { fail = false; throw new Error('read response lost') }
      return read(handle)
    }
    await f.tick(); expect(f.row.number).toBeUndefined()
    f.advance(); await f.tick(); expect(f.row.phase).toBe('credential'); expect(f.purchases).toBe(1)
  })
})
