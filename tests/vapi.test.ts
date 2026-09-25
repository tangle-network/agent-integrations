import { afterEach, describe, expect, it, vi } from 'vitest'
import { vapiConnector } from '../src/connectors/adapters/vapi.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_vapi_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'vapi',
    label: 'vapi test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'vapi_secret' },
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

describe('vapi adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = vapiConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Vapi/i)
  })

})

describe('vapi calls.hangup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /call/{callId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'call_1', status: 'ended' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vapiConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.hangup',
      args: { callId: 'call_1' },
      idempotencyKey: 'k-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.vapi.ai/call/call_1')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      vapiConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.hangup',
        args: { callId: 'call_1' },
        idempotencyKey: 'k-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('vapi assistants.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a POST to /assistant with the create body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'asst_1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vapiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.create',
      args: {
        name: 'Receptionist',
        firstMessage: 'Hello!',
        instructions: 'Be helpful.',
        model: 'gpt-4o',
        provider: 'openai',
        endCallMessage: 'Goodbye',
        overrides: {},
      },
      idempotencyKey: 'k-c-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://api.vapi.ai/assistant')
    expect(requestBody).toMatchObject({ name: 'Receptionist', firstMessage: 'Hello!' })
  })
})

describe('vapi assistants.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues a DELETE to /assistant/{assistantId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await vapiConnector.executeMutation!({
      source: source(),
      capabilityName: 'assistants.delete',
      args: { assistantId: 'asst_77' },
      idempotencyKey: 'k-d-1',
    })

    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toBe('https://api.vapi.ai/assistant/asst_77')
  })
})
