import { afterEach, describe, expect, it, vi } from 'vitest'
import { opsgenieConnector } from '../src/connectors/adapters/opsgenie.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_opsgenie_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'opsgenie',
    label: 'Opsgenie test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'opsgenie-api-key' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('opsgenie adapter manifest', () => {
  it('classifies itself with the opsgenie kind and the other category', () => {
    expect(opsgenieConnector.manifest.kind).toBe('opsgenie')
    expect(opsgenieConnector.manifest.category).toBe('other')
    expect(opsgenieConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares customer-supplied API-key authentication without OAuth scopes', () => {
    const auth = opsgenieConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    expect(opsgenieConnector.manifest.capabilities.every(
      (capability) => capability.requiredScopes === undefined,
    )).toBe(true)
  })

  it('exposes the alert + incident + schedule + oncall + team + user surface', () => {
    const names = opsgenieConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'alerts.list',
        'alerts.get',
        'alerts.create',
        'alerts.acknowledge',
        'alerts.close',
        'alerts.notes.list',
        'alerts.notes.add',
        'incidents.list',
        'incidents.get',
        'incidents.create',
        'incidents.close',
        'incidents.notes.add',
        'schedules.list',
        'schedules.get',
        'schedules.timeline',
        'oncalls.current',
        'oncalls.next',
        'teams.list',
        'teams.get',
        'users.list',
        'users.get',
      ].sort(),
    )
    const reads = opsgenieConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
    const mutations = opsgenieConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
    expect(reads).toContain('alerts.list')
    expect(reads).toContain('incidents.list')
    expect(reads).toContain('oncalls.current')
    expect(reads).toContain('schedules.timeline')
    expect(mutations).toContain('alerts.create')
    expect(mutations).toContain('alerts.acknowledge')
    expect(mutations).toContain('alerts.close')
    expect(mutations).toContain('incidents.create')
    expect(mutations).toContain('incidents.close')
  })

  it('sends the API key as GenieKey to the US root by default', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ data: { name: 'Tangle' } })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(opsgenieConnector.test(source())).resolves.toEqual({ ok: true })

    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(input)).toBe('https://api.opsgenie.com/v2/account')
    expect(new Headers(init.headers).get('authorization')).toBe('GenieKey opsgenie-api-key')
  })

  it('routes API execution to the EU root when selected', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      jsonResponse({ data: [] })
    ))
    vi.stubGlobal('fetch', fetchMock)

    await opsgenieConnector.executeRead!({
      source: source({ metadata: { apiBaseUrl: 'https://api.eu.opsgenie.com' } }),
      capabilityName: 'alerts.list',
      args: {},
      idempotencyKey: 'alerts-eu',
    })

    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(input)).toBe('https://api.eu.opsgenie.com/v2/alerts')
    expect(new Headers(init.headers).get('authorization')).toBe('GenieKey opsgenie-api-key')
  })

  it('rejects non-Opsgenie API roots before sending credentials', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(opsgenieConnector.executeRead!({
      source: source({ metadata: { apiBaseUrl: 'https://opsgenie.attacker.example' } }),
      capabilityName: 'alerts.list',
      args: {},
      idempotencyKey: 'alerts-host-policy',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
