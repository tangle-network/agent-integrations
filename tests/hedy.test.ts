import { describe, expect, it } from 'vitest'
import { hedyConnector } from '../src/connectors/adapters/hedy.js'

describe('hedy adapter manifest', () => {
  it('classifies itself under the doc category and exposes the hedy kind', () => {
    expect(hedyConnector.manifest.kind).toBe('hedy')
    expect(hedyConnector.manifest.category).toBe('doc')
    expect(hedyConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares an api-key auth surface (Hedy uses bearer token auth)', () => {
    const auth = hedyConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
    expect(auth.hint).toContain('Hedy')
  })

  it('exposes topic, session, and context management capabilities', () => {
    const names = hedyConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('topics.create')
    expect(names).toContain('topics.get')
    expect(names).toContain('topics.list')
    expect(names).toContain('topics.update')
    expect(names).toContain('sessions.get')
    expect(names).toContain('sessions.list_by_topic')
    expect(names).toContain('context.create')
    expect(names).toContain('context.get')
  })

  it('classifies capabilities correctly by mutation and read types', () => {
    const createTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.create')
    if (!createTopic) throw new Error('topics.create capability missing')
    expect(createTopic.class).toBe('mutation')

    const getTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.get')
    if (!getTopic) throw new Error('topics.get capability missing')
    expect(getTopic.class).toBe('read')

    const updateTopic = hedyConnector.manifest.capabilities.find((c) => c.name === 'topics.update')
    if (!updateTopic) throw new Error('topics.update capability missing')
    expect(updateTopic.class).toBe('mutation')
  })
})
