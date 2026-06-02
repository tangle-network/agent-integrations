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

describe('bolna adapter manifest', () => {
  it('classifies itself as the comms category and exposes the bolna kind', () => {
    expect(bolnaConnector.manifest.kind).toBe('bolna')
    expect(bolnaConnector.manifest.category).toBe('comms')
    expect(bolnaConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = bolnaConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers reads + makePhoneCall plus new agent CRUD and cancel mutations', () => {
    const names = bolnaConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.list',
        'agents.get',
        'agents.create',
        'agents.update',
        'agents.delete',
        'executions.list',
        'executions.get',
        'calls.make',
        'calls.batch',
        'calls.cancel',
      ].sort(),
    )
    const reads = bolnaConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = bolnaConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['agents.get', 'agents.list', 'executions.get', 'executions.list'])
    expect(mutations).toEqual(
      [
        'agents.create',
        'agents.delete',
        'agents.update',
        'calls.batch',
        'calls.cancel',
        'calls.make',
      ].sort(),
    )
  })

  it('marks the new mutations with native-idempotency CAS and external effect', () => {
    const targets = ['calls.cancel', 'agents.create', 'agents.update', 'agents.delete']
    for (const name of targets) {
      const cap = bolnaConnector.manifest.capabilities.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

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

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      bolnaConnector.executeMutation!({
        source: source(),
        capabilityName: 'calls.cancel',
        args: { executionId: 'exec-9' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
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
