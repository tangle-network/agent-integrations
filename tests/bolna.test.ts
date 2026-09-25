import { afterEach, describe, expect, it, vi } from 'vitest'
import { bolnaConnector } from '../src/connectors/adapters/bolna.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bolna_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bolna',
    label: 'Bolna test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bolna-secret' },
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

describe('bolna calls.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /call/{executionId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ status: 'cancelled', execution_id: 'exec-9' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bolnaConnector.executeMutation!({
      source: source(),
      capabilityName: 'calls.cancel',
      args: { executionId: 'exec-9' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('https://api.bolna.dev/call/exec-9')
    expect(result.status).toBe('committed')
  })
})

describe('bolna agents.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v2/agent with the agent config payload', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ agent_id: 'agt_42' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bolnaConnector.executeMutation!({
      source: source(),
      capabilityName: 'agents.create',
      args: {
        agent_config: { voice: 'eleven_labs_rachel' },
        agent_prompts: { task_1: 'hello' },
      },
      idempotencyKey: 'k-agent-create-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://api.bolna.dev/v2/agent')
    expect(requestBody).toEqual({
      agent_config: { voice: 'eleven_labs_rachel' },
      agent_prompts: { task_1: 'hello' },
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when agent_config is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bolnaConnector.executeMutation!({
        source: source(),
        capabilityName: 'agents.create',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/agent_config/)
  })
})

describe('bolna agents.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PUTs /v2/agent/{agentId} with updated fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ agent_id: 'agt_42', updated: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bolnaConnector.executeMutation!({
      source: source(),
      capabilityName: 'agents.update',
      args: {
        agentId: 'agt_42',
        agent_config: { voice: 'changed' },
        agent_prompts: { task_1: 'updated' },
      },
      idempotencyKey: 'k-agent-update-1',
    })

    expect(requestMethod).toBe('PUT')
    expect(String(requestUrl)).toContain('https://api.bolna.dev/v2/agent/agt_42')
    expect(result.status).toBe('committed')
  })
})

describe('bolna agents.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v2/agent/{agentId}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bolnaConnector.executeMutation!({
      source: source(),
      capabilityName: 'agents.delete',
      args: { agentId: 'agt_42' },
      idempotencyKey: 'k-agent-delete-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('https://api.bolna.dev/v2/agent/agt_42')
    expect(result.status).toBe('committed')
  })
})
