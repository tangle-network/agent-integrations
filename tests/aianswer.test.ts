import { describe, expect, it } from 'vitest'
import { aianswerConnector } from '../src/connectors/adapters/aianswer.js'

describe('aianswer adapter manifest', () => {
  it('classifies itself as the chat category and exposes the aianswer kind', () => {
    expect(aianswerConnector.manifest.kind).toBe('aianswer')
    expect(aianswerConnector.manifest.category).toBe('comms')
    expect(aianswerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = aianswerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the catalog action set: agents list and call create/get/schedule/transcript', () => {
    const names = aianswerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.list',
        'calls.create',
        'calls.get',
        'calls.schedule',
        'calls.transcript',
      ].sort(),
    )
    const reads = aianswerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = aianswerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['agents.list', 'calls.get', 'calls.transcript'])
    expect(mutations).toEqual(['calls.create', 'calls.schedule'])
  })
})
