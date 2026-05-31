import { describe, expect, it } from 'vitest'
import { datadogConnector } from '../src/connectors/adapters/datadog.js'

describe('datadog adapter manifest', () => {
  it('classifies itself as an observability ingest connector with kind=datadog', () => {
    expect(datadogConnector.manifest.kind).toBe('datadog')
    expect(datadogConnector.manifest.category).toBe('other')
    expect(datadogConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a hint pointing at the regional intake metadata field', () => {
    const auth = datadogConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/DD-API-KEY/)
    expect(auth.hint).toMatch(/intakeUrl/)
    expect(auth.hint).toMatch(/datadoghq\.com/)
  })

  it('covers the ingest surface — logs, metrics (v1 + v2 + distribution), events, service checks, and a validate probe', () => {
    const names = datadogConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'auth.validate',
        'logs.submit',
        'metrics.submit',
        'metrics.submit.v1',
        'metrics.distribution.submit',
        'events.post',
        'events.list',
        'events.get',
        'checks.submit',
      ].sort(),
    )
    const reads = datadogConnector.manifest.capabilities.filter((c) => c.class === 'read').map((c) => c.name).sort()
    const mutations = datadogConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['auth.validate', 'events.get', 'events.list'])
    expect(mutations).toEqual(
      [
        'checks.submit',
        'events.post',
        'logs.submit',
        'metrics.distribution.submit',
        'metrics.submit',
        'metrics.submit.v1',
      ].sort(),
    )
  })

  it('marks every ingest mutation as an external effect so the hub guard records replays', () => {
    const mutations = datadogConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const m of mutations) {
      if (m.class !== 'mutation') throw new Error('unreachable')
      expect(m.externalEffect).toBe(true)
    }
  })
})
