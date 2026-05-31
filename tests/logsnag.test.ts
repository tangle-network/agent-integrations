import { describe, expect, it } from 'vitest'
import { logsnagConnector } from '../src/connectors/adapters/logsnag.js'

describe('logsnag adapter manifest', () => {
  it('classifies itself as the comms category and exposes the logsnag kind', () => {
    expect(logsnagConnector.manifest.kind).toBe('logsnag')
    expect(logsnagConnector.manifest.category).toBe('comms')
    expect(logsnagConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares api-key auth matching the activepieces catalog', () => {
    const auth = logsnagConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the create-event action declared by the activepieces piece', () => {
    const names = logsnagConnector.manifest.capabilities.map((c) => c.name)
    // The activepieces catalog only ships `createEvent`; our surface extends with
    // real LogSnag endpoints (identify, group, insight, insight mutate) — but
    // the catalog-declared action MUST be present.
    expect(names).toContain('create.event')

    // Every capability is a mutation — LogSnag's public API is write-only.
    const reads = logsnagConnector.manifest.capabilities.filter((c) => c.class === 'read')
    const mutations = logsnagConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    expect(reads).toEqual([])
    expect(mutations.length).toBe(logsnagConnector.manifest.capabilities.length)
  })

  it('requires project + channel + event on the catalog-declared create.event capability', () => {
    const createEvent = logsnagConnector.manifest.capabilities.find((c) => c.name === 'create.event')
    expect(createEvent).toBeDefined()
    const required = ((createEvent?.parameters as { required?: string[] } | undefined)?.required ?? []).sort()
    expect(required).toEqual(['channel', 'event', 'project'])
  })
})
