import { describe, expect, it } from 'vitest'
import { conversationEndpointOptions, listConversationChannels } from '../src/conversation-events/channels.js'
const row = { id: '550e8400-e29b-41d4-a716-446655440000', phone_number: '+15551234567', reputation: { status: 'HEALTHY' } }
describe('owned conversation endpoints', () => {
  it('exposes inventory without claiming a purchase API', () => {
    expect(listConversationChannels().find(c => c.providerId === 'linq')).toMatchObject({ inventoryAction: 'linq.phone_numbers.list', numberProvisioning: 'provider-assigned' })
    expect(conversationEndpointOptions('linq', { phone_numbers: [row] })).toEqual([{ id: row.id, address: row.phone_number, providerId: 'linq', channel: 'imessage', health: 'healthy' }])
  })
  it.each([{}, { phone_numbers: {} }, { phone_numbers: [{...row, id: ''}] }, { phone_numbers: [{...row, phone_number: '15551234567'}] }, { phone_numbers: [row, row] }])('rejects unproven endpoint inventory %j', payload => {
    expect(() => conversationEndpointOptions('linq', payload)).toThrow()
  })
  it('keeps missing health unknown and critical lines explicit', () => {
    expect(conversationEndpointOptions('linq', { phone_numbers: [{...row, reputation: undefined}] })[0].health).toBe('unknown')
    expect(conversationEndpointOptions('linq', { phone_numbers: [{...row, reputation: {status:'CRITICAL'}}] })[0].health).toBe('critical')
  })
  it('does not reuse another provider protocol', () => expect(() => conversationEndpointOptions('inkbox', { phone_numbers: [row] })).toThrow(/not available/))
})
