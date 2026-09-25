import { afterEach, describe, expect, it, vi } from 'vitest'
import { vboutConnector } from '../src/connectors/adapters/vbout.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vbout_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vbout',
    label: 'vbout test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'vbout_secret' },
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

describe('vbout contacts.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/contacts/delete with the contact email', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'contacts.delete',
      args: { email: 'gone@example.com' },
      idempotencyKey: 'k-cd-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/1/contacts/delete')
    expect(requestBody).toMatchObject({ email: 'gone@example.com' })
  })
})

describe('vbout lists.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/lists/delete with the list id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'lists.delete',
      args: { id: 'list_77' },
      idempotencyKey: 'k-ld-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/lists/delete')
    expect(requestBody).toMatchObject({ id: 'list_77' })
  })
})

describe('vbout campaigns.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/campaigns/send with the campaign id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ queued: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.send',
      args: { id: 'camp_1', schedule: '2026-06-10T12:00:00Z' },
      idempotencyKey: 'k-cs-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/campaigns/send')
    expect(requestBody).toMatchObject({ id: 'camp_1', schedule: '2026-06-10T12:00:00Z' })
  })
})

describe('vbout campaigns.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /1/campaigns/delete with the campaign id', async () => {
    let requestUrl: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vboutConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaigns.delete',
      args: { id: 'camp_9' },
      idempotencyKey: 'k-cdel-1',
    })

    expect(result.status).toBe('committed')
    expect(String(requestUrl)).toContain('/1/campaigns/delete')
    expect(requestBody).toMatchObject({ id: 'camp_9' })
  })
})
