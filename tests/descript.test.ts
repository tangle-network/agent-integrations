import { afterEach, describe, expect, it, vi } from 'vitest'
import { descriptConnector } from '../src/connectors/adapters/descript.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_descript_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'descript',
    label: 'descript test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'descript_secret' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('descript adapter manifest', () => {
  it('classifies itself as the storage category and exposes the descript kind', () => {
    expect(descriptConnector.manifest.kind).toBe('descript')
    expect(descriptConnector.manifest.category).toBe('storage')
    expect(descriptConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = descriptConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus the new projects.delete mutation', () => {
    const names = descriptConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'projects.list',
        'projects.get',
        'projects.delete',
        'jobs.get',
        'agent.edit',
        'media.import',
        'project.publish',
      ].sort(),
    )
    const reads = descriptConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = descriptConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['jobs.get', 'projects.get', 'projects.list'].sort())
    expect(mutations).toEqual(
      ['agent.edit', 'media.import', 'project.publish', 'projects.delete'].sort(),
    )
  })

  it('marks projects.delete as native-idempotency + externalEffect=true', () => {
    const cap = descriptConnector.manifest.capabilities.find((c) => c.name === 'projects.delete')
    expect(cap).toBeDefined()
    if (!cap || cap.class !== 'mutation') throw new Error('projects.delete must be a mutation')
    expect(cap.cas).toBe('native-idempotency')
    expect(cap.externalEffect).toBe(true)
  })
})

describe('descript projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/projects/{project_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await descriptConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { project_id: 'proj_abc' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://api.descript.com/v1/projects/proj_abc')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      descriptConnector.executeMutation!({
        source: source(),
        capabilityName: 'projects.delete',
        args: { project_id: 'proj_abc' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
