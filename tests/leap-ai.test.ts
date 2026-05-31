import { describe, expect, it } from 'vitest'
import { leapAiConnector } from '../src/connectors/adapters/leap-ai.js'

describe('leap-ai adapter manifest', () => {
  it('classifies itself under the other category and exposes the leap-ai kind', () => {
    expect(leapAiConnector.manifest.kind).toBe('leap-ai')
    expect(leapAiConnector.manifest.category).toBe('other')
    expect(leapAiConnector.manifest.defaultConsistencyModel).toBe('advisory')
  })

  it('declares an api-key auth surface (Leap AI has no OAuth flow)', () => {
    const auth = leapAiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(typeof auth.hint).toBe('string')
  })

  it('exposes the run and getRun capabilities from the activepieces catalog', () => {
    const names = leapAiConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['workflows.getRun', 'workflows.run'])

    const run = leapAiConnector.manifest.capabilities.find((c) => c.name === 'workflows.run')
    if (!run) throw new Error('workflows.run capability missing')
    expect(run.class).toBe('mutation')

    const getRun = leapAiConnector.manifest.capabilities.find((c) => c.name === 'workflows.getRun')
    if (!getRun) throw new Error('workflows.getRun capability missing')
    expect(getRun.class).toBe('read')
  })
})
