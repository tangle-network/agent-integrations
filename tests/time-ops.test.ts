import { describe, expect, it } from 'vitest'
import { timeOpsConnector } from '../src/connectors/adapters/time-ops.js'

describe('time-ops adapter manifest', () => {
  it('classifies itself as the other category and exposes the time-ops kind', () => {
    expect(timeOpsConnector.manifest.kind).toBe('time-ops')
    expect(timeOpsConnector.manifest.category).toBe('other')
    expect(timeOpsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a TimeOps-specific hint', () => {
    const auth = timeOpsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/TimeOps/i)
  })

  it('covers customers, projects, registrations, and timers capability surface', () => {
    const names = timeOpsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('customers.create')
    expect(names).toContain('customers.list')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.list')
    expect(names).toContain('registrations.create')
    expect(names).toContain('registrations.list')
    expect(names).toContain('timers.start')
    expect(names).toContain('timers.stop')
  })

  it('marks destructive and write operations as mutations', () => {
    const mutations = timeOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toContain('customers.create')
    expect(mutations).toContain('projects.create')
    expect(mutations).toContain('registrations.create')
    expect(mutations).toContain('timers.start')
    expect(mutations).toContain('timers.stop')
  })

  it('marks read-only operations as read', () => {
    const reads = timeOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    expect(reads).toContain('customers.list')
    expect(reads).toContain('projects.list')
    expect(reads).toContain('registrations.list')
  })
})
