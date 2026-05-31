import { describe, expect, it } from 'vitest'
import { ticktickConnector } from '../src/connectors/adapters/ticktick.js'

describe('ticktick adapter manifest', () => {
  it('classifies itself as the other category and exposes the ticktick kind', () => {
    expect(ticktickConnector.manifest.kind).toBe('ticktick')
    expect(ticktickConnector.manifest.category).toBe('other')
    expect(ticktickConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares oauth2 auth with TickTick-specific endpoints', () => {
    const auth = ticktickConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toMatch(/ticktick.com/)
    expect(auth.tokenUrl).toMatch(/ticktick.com/)
  })

  it('covers task and project capability surface', () => {
    const names = ticktickConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('tasks.create')
    expect(names).toContain('tasks.update')
    expect(names).toContain('tasks.get')
    expect(names).toContain('tasks.find')
    expect(names).toContain('tasks.complete')
    expect(names).toContain('tasks.delete')
    expect(names).toContain('projects.get')
  })

  it('marks mutations and read operations correctly', () => {
    const mutations = ticktickConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('tasks.create')
    expect(mutations).toContain('tasks.update')
    expect(mutations).toContain('tasks.complete')
    expect(mutations).toContain('tasks.delete')

    const reads = ticktickConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toContain('tasks.get')
    expect(reads).toContain('tasks.find')
    expect(reads).toContain('projects.get')
  })
})
