import { describe, expect, it } from 'vitest'
import { conversationEndpointOptions as project, listConversationChannels } from '../src/conversation-events/index.js'

const phone = { id: 'pn_opaque', phone_number: '+1 (555) 000-0002', quality: 'future_quality', messaging_tier: 'future_tier' }
const linq = { id: '11111111-1111-4111-8111-111111111111', phone_number: '+15550000002', reputation: { status: 'HEALTHY' } }

describe('owned conversation endpoints', () => {
  it('discovers WhatsApp inventory and reply actions from the shared catalog', () => {
    const channel = listConversationChannels().find(value => value.providerId === 'linq-whatsapp')
    expect(channel?.inventoryAction).toBe('linq-whatsapp.numbers.list')
    expect(channel?.replyAction).toBe('linq-whatsapp.messages.reply')
  })
  it('preserves opaque WhatsApp IDs and provider-formatted display addresses', () => {
    expect(project('linq-whatsapp', { data: [phone] })).toEqual([
      { id: phone.id, address: phone.phone_number, providerId: 'linq-whatsapp', channel: 'whatsapp', health: 'unknown' },
    ])
  })
  it.each([
    ['green', 'healthy'], ['yellow', 'at-risk'], ['red', 'critical'], ['future', 'unknown'], [undefined, 'unknown'],
  ])('maps only the documented quality band %s to %s', (band, health) => {
    expect(project('linq-whatsapp', { data: [{ ...phone, quality_band: band }] })[0]?.health).toBe(health)
  })
  it('preserves the existing Linq projection', () => {
    expect(project('linq', { phone_numbers: [linq] })).toEqual([
      { id: linq.id, address: linq.phone_number, providerId: 'linq', channel: 'imessage', health: 'healthy' },
    ])
  })
  for (const provider of ['linq', 'linq-whatsapp']) {
    const wrap = (rows: unknown) => provider === 'linq' ? { phone_numbers: rows } : { data: rows }
    const row = provider === 'linq' ? linq : phone
    it(`${provider} accepts an authoritative empty inventory`, () => {
      expect(project(provider, wrap([]))).toEqual([])
    })
    for (const [name, result] of [
      ['null', null], ['missing inventory', {}], ['array envelope', []],
      ['invalid inventory', wrap({})], ['invalid row', wrap([null])], ['too many rows', wrap(Array(1001).fill(row))],
    ] as const) {
      it(`${provider} rejects ${name}`, () => expect(() => project(provider, result)).toThrow())
    }
    it(`${provider} rejects duplicate resource IDs`, () => {
      expect(() => project(provider, wrap([row, { ...row, phone_number: '+15550000003' }]))).toThrow()
    })
    it(`${provider} rejects duplicate addresses`, () => {
      expect(() => project(provider, wrap([row, { ...row, id: '22222222-2222-4222-8222-222222222222' }]))).toThrow()
    })
    it(`${provider} does not mutate the authenticated source`, () => {
      const value = wrap([{ ...row }]), original = structuredClone(value)
      project(provider, value)
      expect(value).toEqual(original)
    })
  }
  it.each(['', '   ', 'x\nkey', '\u007f', 'x'.repeat(257)])('rejects invalid opaque ID %j', id => {
    expect(() => project('linq-whatsapp', { data: [{ ...phone, id }] })).toThrow()
  })
  it.each(['', '   ', '+1\rBCC: hidden', 'x'.repeat(321)])('rejects invalid display address %j', address => {
    expect(() => project('linq-whatsapp', { data: [{ ...phone, phone_number: address }] })).toThrow()
  })
  it('rejects a hyphen-only impostor UUID in Linq inventory', () => {
    expect(() => project('linq', { phone_numbers: [{ ...linq, id: '-'.repeat(36) }] })).toThrow()
  })
  it('does not guess a protocol for an unknown provider', () => {
    expect(() => project('unknown', { data: [phone] })).toThrow()
  })
})
