import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeConnector } from '../src/connectors/adapters/make.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(zoneUrl: string): ResolvedDataSource {
  return {
    id: 'src_make_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'make',
    label: 'Make test',
    consistencyModel: 'advisory',
    scopes: [],
    metadata: { zoneUrl },
    credentials: { kind: 'api-key', apiKey: 'make_secret' },
    status: 'active',
  }
}

describe('make adapter manifest', () => {
  it('exposes the make kind in the other category', () => {
    expect(makeConnector.manifest.kind).toBe('make')
    expect(makeConnector.manifest.category).toBe('other')
  })

  it('uses api-key auth (account-scoped token, regional zone host)', () => {
    expect(makeConnector.manifest.auth.kind).toBe('api-key')
  })

  it('covers scenarios, executions, and webhook-trigger surfaces', () => {
    const names = makeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'scenarios.list',
        'scenarios.get',
        'scenarios.run',
        'scenarios.activate',
        'scenarios.deactivate',
        'executions.list',
        'executions.get',
        'hooks.trigger',
      ].sort(),
    )
  })
})

describe('make credential routing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the configured Make zone with Token authorization', async () => {
    let requestUrl = ''
    let requestHeaders: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = init?.headers as Record<string, string>
      return new Response(JSON.stringify({ scenarios: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }))

    await makeConnector.executeRead!({
      source: source('https://eu1.make.com'),
      capabilityName: 'scenarios.list',
      args: { teamId: 'team_1' },
      idempotencyKey: 'make-list-1',
    })

    expect(requestUrl).toBe('https://eu1.make.com/api/v2/scenarios?teamId=team_1')
    expect(requestHeaders.Authorization ?? requestHeaders.authorization).toBe('Token make_secret')
  })

  it('rejects a non-Make zone before sending the API token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(makeConnector.executeRead!({
      source: source('https://attacker.example'),
      capabilityName: 'scenarios.list',
      args: { teamId: 'team_1' },
      idempotencyKey: 'make-rejected-zone',
    })).rejects.toThrow('connection base URL is not an allowed provider endpoint')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces rejected Make credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    await expect(makeConnector.executeRead!({
      source: source('https://us1.make.com'),
      capabilityName: 'scenarios.list',
      args: { teamId: 'team_1' },
      idempotencyKey: 'make-rejected-credentials',
    })).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
