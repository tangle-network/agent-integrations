import { afterEach, describe, expect, it, vi } from 'vitest'
import { aminosConnector } from '../src/connectors/adapters/aminos.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_aminos_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'aminos',
    label: 'aminos test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://panel.example.com' },
    credentials: { kind: 'api-key', apiKey: 'aminos_secret' },
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

describe('aminos adapter manifest', () => {
  it('classifies itself as other and exposes the aminos kind', () => {
    expect(aminosConnector.manifest.kind).toBe('aminos')
    expect(aminosConnector.manifest.category).toBe('other')
    expect(aminosConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as the catalog says', () => {
    const auth = aminosConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the user lifecycle: create, update, delete, list', () => {
    const names = aminosConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(['users.create', 'users.delete', 'users.list', 'users.update'])
    const mutations = aminosConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(['users.create', 'users.delete', 'users.update'])
    const reads = aminosConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['users.list'])
  })

  it('marks the new write mutations as native-idempotency external-effect', () => {
    for (const name of ['users.update', 'users.delete']) {
      const cap = aminosConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error('expected mutation')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('aminos users.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /api/users/{userid} with the patched fields', async () => {
    let requestUrl = ''
    let requestMethod = ''
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'u_1', userfriendlyname: 'Drew' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await aminosConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.update',
      args: { userid: 'u_1', userfriendlyname: 'Drew', userplanid: 7 },
      idempotencyKey: 'k-update',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://panel.example.com/api/users/u_1')
    expect(requestBody).toEqual({ userid: 'u_1', userfriendlyname: 'Drew', userplanid: 7 })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      aminosConnector.executeMutation!({
        source: source(),
        capabilityName: 'users.update',
        args: { userid: 'u_1', userfriendlyname: 'Drew' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('aminos users.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /api/users/{userid}', async () => {
    let requestUrl = ''
    let requestMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method ?? ''
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await aminosConnector.executeMutation!({
      source: source(),
      capabilityName: 'users.delete',
      args: { userid: 'u_42' },
      idempotencyKey: 'k-del',
    })

    expect(requestMethod).toBe('DELETE')
    expect(requestUrl).toBe('https://panel.example.com/api/users/u_42')
    expect(result.status).toBe('committed')
  })
})
