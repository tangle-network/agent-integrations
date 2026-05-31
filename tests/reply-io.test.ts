import { describe, expect, it } from 'vitest'
import { replyIoConnector } from '../src/connectors/adapters/reply-io.js'

describe('reply-io adapter manifest', () => {
  it('classifies itself as the crm category and exposes the reply-io kind', () => {
    expect(replyIoConnector.manifest.kind).toBe('reply-io')
    expect(replyIoConnector.manifest.category).toBe('crm')
    expect(replyIoConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = replyIoConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (contacts and campaigns)', () => {
    const names = replyIoConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'contacts.create',
        'contacts.push_to_campaign',
        'contacts.create_and_push',
        'contacts.get',
        'contacts.mark_replied',
        'contacts.mark_finished',
        'contacts.remove_from_campaign',
        'contacts.remove_from_all_campaigns',
        'contacts.delete',
      ].sort(),
    )
    const reads = replyIoConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = replyIoConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['contacts.get'].sort())
    expect(mutations).toEqual(
      [
        'contacts.create',
        'contacts.push_to_campaign',
        'contacts.create_and_push',
        'contacts.mark_replied',
        'contacts.mark_finished',
        'contacts.remove_from_campaign',
        'contacts.remove_from_all_campaigns',
        'contacts.delete',
      ].sort(),
    )
  })
})
