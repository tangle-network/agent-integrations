import { describe, expect, it } from 'vitest'
import { timelinesAiConnector } from '../src/connectors/adapters/timelines-ai.js'

describe('timelines-ai adapter manifest', () => {
  it('classifies itself as the crm category and exposes the timelines-ai kind', () => {
    expect(timelinesAiConnector.manifest.kind).toBe('timelines-ai')
    expect(timelinesAiConnector.manifest.category).toBe('crm')
    expect(timelinesAiConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = timelinesAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set (chats, messages, files, accounts)', () => {
    const names = timelinesAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'chats.find',
        'chats.close',
        'messages.find',
        'messages.status',
        'messages.send',
        'messages.send.to.new.chat',
        'files.find',
        'files.send',
        'files.send.uploaded',
        'accounts.find',
      ].sort(),
    )
    const reads = timelinesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = timelinesAiConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['chats.find', 'messages.find', 'messages.status', 'files.find', 'accounts.find'].sort(),
    )
    expect(mutations).toEqual(
      [
        'chats.close',
        'messages.send',
        'messages.send.to.new.chat',
        'files.send',
        'files.send.uploaded',
      ].sort(),
    )
  })
})
