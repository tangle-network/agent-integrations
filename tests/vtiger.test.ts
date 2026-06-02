import { afterEach, describe, expect, it, vi } from 'vitest'
import { vtigerConnector } from '../src/connectors/adapters/vtiger.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vtiger_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vtiger',
    label: 'vtiger test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instance_url: 'https://crm.example.com' },
    credentials: { kind: 'api-key', apiKey: 'vtiger_secret' },
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

describe('vtiger adapter manifest', () => {
  it('classifies itself as the crm category and exposes the vtiger kind', () => {
    expect(vtigerConnector.manifest.kind).toBe('vtiger')
    expect(vtigerConnector.manifest.category).toBe('crm')
    expect(vtigerConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = vtigerConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus write-side extensions', () => {
    const names = vtigerConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'records.search',
        'records.get',
        'records.create',
        'records.update',
        'records.delete',
        'records.query',
        'records.assign',
        'records.convert',
        'files.upload',
        'comments.create',
      ].sort(),
    )
    const reads = vtigerConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = vtigerConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['records.get', 'records.query', 'records.search'].sort())
    expect(mutations).toEqual(
      [
        'records.create',
        'records.delete',
        'records.update',
        'records.assign',
        'records.convert',
        'files.upload',
        'comments.create',
      ].sort(),
    )
  })

  it('marks every new write-side mutation as native-idempotency externalEffect', () => {
    const expectedExternal = new Set([
      'records.assign',
      'records.convert',
      'files.upload',
      'comments.create',
    ])
    for (const c of vtigerConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      if (!expectedExternal.has(c.name)) continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('vtiger records.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the assign sub-path with the assigned_user_id body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ success: true })
    }))

    const result = await vtigerConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.assign',
      args: { recordId: 'rec_1', assigned_user_id: 'usr_9' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/restapi/v1/vtiger/default/records/rec_1/assign')
    expect(requestBody).toMatchObject({ assigned_user_id: 'usr_9' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      vtigerConnector.executeMutation!({
        source: source(),
        capabilityName: 'records.assign',
        args: { recordId: 'rec_1', assigned_user_id: 'usr_9' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('vtiger records.convert', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the convert sub-path with the full args body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'contact_42' })
    }))

    await vtigerConnector.executeMutation!({
      source: source(),
      capabilityName: 'records.convert',
      args: { recordId: 'lead_1', targetModule: 'Contacts', data: { firstname: 'A' } },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/restapi/v1/vtiger/default/records/lead_1/convert')
    expect(requestBody).toMatchObject({ targetModule: 'Contacts', recordId: 'lead_1' })
  })
})

describe('vtiger files.upload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the documents sub-path with the file payload', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'doc_1' })
    }))

    await vtigerConnector.executeMutation!({
      source: source(),
      capabilityName: 'files.upload',
      args: { recordId: 'rec_1', filename: 'a.pdf', content: 'aGVsbG8=' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('/restapi/v1/vtiger/default/records/rec_1/documents')
    expect(requestBody).toMatchObject({ filename: 'a.pdf', content: 'aGVsbG8=' })
  })
})

describe('vtiger comments.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the comments sub-path with the comment body', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'cmt_1' })
    }))

    await vtigerConnector.executeMutation!({
      source: source(),
      capabilityName: 'comments.create',
      args: { recordId: 'rec_1', comment: 'hi' },
      idempotencyKey: 'k-1',
    })

    expect(String(requestUrl)).toContain('/restapi/v1/vtiger/default/records/rec_1/comments')
    expect(requestBody).toMatchObject({ comment: 'hi' })
  })
})
