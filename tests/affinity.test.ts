import { afterEach, describe, expect, it, vi } from 'vitest'
import { affinityConnector } from '../src/connectors/adapters/affinity.js'
import { validateConnectorManifest, type ResolvedDataSource } from '../src/connectors/types.js'

const source: ResolvedDataSource = {
  id: 'src_affinity',
  projectId: 'project_1',
  publishedAgentId: null,
  kind: 'affinity',
  label: 'Affinity test',
  consistencyModel: 'authoritative',
  scopes: [],
  metadata: {},
  credentials: { kind: 'api-key', apiKey: 'affinity_secret' },
  status: 'active',
}

describe('affinity adapter', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ships a valid authoritative CRM manifest with deep record coverage', () => {
    expect(validateConnectorManifest(affinityConnector.manifest)).toEqual({ ok: true, issues: [] })
    expect(affinityConnector.manifest.kind).toBe('affinity')
    expect(affinityConnector.manifest.category).toBe('crm')
    expect(affinityConnector.manifest.auth.kind).toBe('api-key')
    expect(affinityConnector.manifest.capabilities).toHaveLength(30)
    expect(affinityConnector.manifest.capabilities.map((capability) => capability.name)).toEqual(
      expect.arrayContaining([
        'people.list',
        'organizations.update',
        'opportunities.delete',
        'list-entries.create',
        'field-value-changes.list',
        'interactions.list',
        'notes.create',
      ]),
    )
  })

  it('uses bearer auth and renders search pagination', async () => {
    let requestUrl = ''
    let requestAuth = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestAuth = new Headers(init?.headers).get('authorization') ?? ''
      return Response.json({ persons: [] })
    }))

    await affinityConnector.executeRead!({
      source,
      capabilityName: 'people.list',
      args: { term: 'Ada', page_size: 25, page_token: 'next' },
      idempotencyKey: 'read_1',
    })

    const url = new URL(requestUrl)
    expect(url.origin).toBe('https://api.affinity.co')
    expect(url.pathname).toBe('/persons')
    expect(url.searchParams.get('term')).toBe('Ada')
    expect(url.searchParams.get('page_size')).toBe('25')
    expect(requestAuth).toBe('Bearer affinity_secret')
  })

  it('requires identifiers before issuing record reads', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(affinityConnector.executeRead!({
      source,
      capabilityName: 'people.get',
      args: {},
      idempotencyKey: 'read_2',
    })).rejects.toThrow(/personId/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('encodes record identifiers so caller input cannot escape the provider path', async () => {
    let requestUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return Response.json({ id: 7 })
    }))

    await affinityConnector.executeRead!({
      source,
      capabilityName: 'people.get',
      args: { personId: '../organizations/1' },
      idempotencyKey: 'read_path',
    })

    expect(new URL(requestUrl).pathname).toBe('/persons/..%2Forganizations%2F1')
  })

  it('executes approved writes on the provider endpoint', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ id: 42 }, { status: 201 })
    }))

    const result = await affinityConnector.executeMutation!({
      source,
      capabilityName: 'notes.create',
      args: { content: 'Follow up', person_ids: [7] },
      idempotencyKey: 'write_1',
    })

    expect(requestUrl).toBe('https://api.affinity.co/notes')
    expect(requestMethod).toBe('POST')
    expect(requestBody).toEqual({ content: 'Follow up', person_ids: [7] })
    expect(result.status).toBe('committed')
  })

  it('reports revoked credentials without exposing the API key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid affinity_secret', { status: 401 })))
    let message = ''
    try {
      await affinityConnector.executeRead!({
        source,
        capabilityName: 'people.list',
        args: {},
        idempotencyKey: 'read_3',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/expired|revoked|credentials/i)
    expect(message).not.toContain('affinity_secret')
  })

  it('returns malformed successful provider output as inert raw data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>upstream error page</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })))

    const result = await affinityConnector.executeRead!({
      source,
      capabilityName: 'people.list',
      args: {},
      idempotencyKey: 'read_malformed',
    })

    expect(result.data).toEqual({ raw: '<html>upstream error page</html>' })
  })
})
