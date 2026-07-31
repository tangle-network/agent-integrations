import { afterEach, describe, expect, it, vi } from 'vitest'
import { supabaseConnector } from '../src/connectors/adapters/supabase.js'
import {
  validateConnectorManifest,
  type ResolvedDataSource,
} from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_supabase_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'supabase',
    label: 'supabase test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'sbp_personal_access_token' },
    status: 'active',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status })
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('supabase adapter manifest', () => {
  it('classifies itself as other and exposes the supabase kind', () => {
    expect(supabaseConnector.manifest.kind).toBe('supabase')
    expect(supabaseConnector.manifest.category).toBe('other')
    expect(supabaseConnector.manifest.defaultConsistencyModel).toBe('authoritative')
    expect(validateConnectorManifest(supabaseConnector.manifest)).toEqual({
      ok: true,
      issues: [],
    })
  })

  it('requires a customer-supplied Management API personal access token', () => {
    const auth = supabaseConnector.manifest.auth
    expect(auth).toEqual({
      kind: 'api-key',
      hint: expect.stringContaining('personal access token'),
    })
  })

  it('exposes both pre-existing and new write-side capabilities', () => {
    const names = supabaseConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toContain('organizations.list')
    expect(names).toContain('projects.list')
    expect(names).toContain('projects.get')
    expect(names).toContain('projects.create')
    expect(names).toContain('projects.delete')
    expect(names).toContain('branches.create')
    expect(names).toContain('branches.delete')
    expect(names).toContain('database.query')
    expect(names).toContain('database.execute')
    expect(names).toContain('secrets.list')
    expect(names).toContain('secrets.upsert')
    expect(names).toContain('secrets.delete')
    expect(names).toContain('storage.upload')
  })

  it('marks every new write-side mutation as native-idempotency + externalEffect=true', () => {
    const newMutations = new Set([
      'projects.delete',
      'branches.create',
      'branches.delete',
      'secrets.delete',
      'storage.upload',
    ])
    const caps = supabaseConnector.manifest.capabilities.filter(
      (c) => newMutations.has(c.name) && c.class === 'mutation',
    )
    expect(caps.length).toBe(newMutations.size)
    for (const cap of caps) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })

  it('does not advertise OAuth scopes and treats arbitrary SQL as an approved mutation', () => {
    const query = supabaseConnector.manifest.capabilities.find(
      (capability) => capability.name === 'database.query',
    )

    expect(query).toMatchObject({
      class: 'mutation',
      cas: 'native-idempotency',
      externalEffect: true,
    })
    expect(
      supabaseConnector.manifest.capabilities.every(
        (capability) => capability.requiredScopes === undefined,
      ),
    ).toBe(true)
  })
})

describe('supabase projects.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the customer personal access token as bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await supabaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'projects.delete',
      args: { ref: 'abcdefghijklmnop' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/projects/abcdefghijklmnop')
    expect(authHeader).toBe('Bearer sbp_personal_access_token')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      supabaseConnector.executeMutation!({
        source: source(),
        capabilityName: 'projects.delete',
        args: { ref: 'abcdefghijklmnop' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('supabase branches.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /v1/projects/{ref}/branches with the branch payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'br_1', name: 'preview' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await supabaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'branches.create',
      args: { ref: 'abcdefghijklmnop', branch_name: 'preview' },
      idempotencyKey: 'k-br-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/projects/abcdefghijklmnop/branches')
    expect(requestBody).toMatchObject({ branch_name: 'preview' })
  })
})

describe('supabase branches.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/branches/{branch_id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await supabaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'branches.delete',
      args: { branch_id: 'br_1' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/branches/br_1')
  })
})

describe('supabase secrets.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /v1/projects/{ref}/secrets?name={name}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({}, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await supabaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'secrets.delete',
      args: { ref: 'abcdefghijklmnop', name: 'API_KEY' },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/v1/projects/abcdefghijklmnop/secrets')
    expect(String(requestUrl)).toContain('name=API_KEY')
  })
})

describe('supabase storage.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the storage bucket object path', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ Key: 'bucket/foo.txt' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await supabaseConnector.executeMutation!({
      source: source(),
      capabilityName: 'storage.upload',
      args: {
        ref: 'abcdefghijklmnop',
        bucket: 'assets',
        path: 'foo.txt',
        content: 'hello world',
      },
      idempotencyKey: 'k-up-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/projects/abcdefghijklmnop/storage/buckets/assets/objects/foo.txt')
  })
})
