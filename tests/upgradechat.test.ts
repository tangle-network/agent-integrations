import { describe, expect, it } from 'vitest'
import { upgradechatConnector } from '../src/connectors/adapters/upgradechat.js'

describe('upgradechat adapter manifest', () => {
  it('classifies itself as the crm category and exposes the upgradechat kind', () => {
    expect(upgradechatConnector.manifest.kind).toBe('upgradechat')
    expect(upgradechatConnector.manifest.category).toBe('crm')
    expect(upgradechatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with an Upgrade.chat-specific hint', () => {
    const auth = upgradechatConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Upgrade\.chat/i)
  })

  it('covers contacts, subscriptions, invoices, and products capability surface', () => {
    const names = upgradechatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('contacts.add_or_update')
    expect(names).toContain('contacts.get')
    expect(names).toContain('subscriptions.add_or_update')
    expect(names).toContain('invoices.create')
    expect(names).toContain('products.create')
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = upgradechatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('contacts.add_or_update')
    expect(mutations).toContain('subscriptions.add_or_update')
    expect(mutations).toContain('invoices.create')
    expect(mutations).toContain('products.create')
  })

  it('marks read-only operations as read', () => {
    const reads = upgradechatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('contacts.get')
  })
})
