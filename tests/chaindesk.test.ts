import { afterEach, describe, expect, it, vi } from 'vitest'
import { chaindeskConnector } from '../src/connectors/adapters/chaindesk.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_chaindesk_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'chaindesk',
    label: 'Chaindesk test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'chaindesk-secret' },
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

describe('chaindesk adapter manifest', () => {
  it('classifies itself as the other category and exposes the chaindesk kind', () => {
    expect(chaindeskConnector.manifest.kind).toBe('chaindesk')
    expect(chaindeskConnector.manifest.category).toBe('other')
    expect(chaindeskConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = chaindeskConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the original catalog action set plus the new datasource / agent writes', () => {
    const names = chaindeskConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'agents.create',
        'agents.query',
        'datasources.create',
        'datasources.delete',
        'datasources.query',
        'files.upload',
      ].sort(),
    )
    const mutations = chaindeskConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      ['agents.create', 'datasources.create', 'datasources.delete', 'files.upload'].sort(),
    )
  })

  it('marks every mutation as native-idempotency external effect', () => {
    for (const cap of chaindeskConnector.manifest.capabilities) {
      if (cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('chaindesk datasources.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /datasources with the supplied agentId and source', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'ds_1' })
      }),
    )
    const result = await chaindeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasources.create',
      args: {
        agentId: 'agent_1',
        name: 'Onboarding docs',
        type: 'text',
        source: 'hello world',
        config: { chunkSize: 1024 },
      },
      idempotencyKey: 'k-ds-create-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.chaindesk.ai/api/datasources')
    expect(capturedBody).toEqual({
      agentId: 'agent_1',
      name: 'Onboarding docs',
      type: 'text',
      source: 'hello world',
      config: { chunkSize: 1024 },
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      chaindeskConnector.executeMutation!({
        source: source(),
        capabilityName: 'datasources.create',
        args: {
          agentId: 'agent_1',
          name: 'Onboarding docs',
          type: 'text',
          source: 'hello world',
          config: {},
        },
        idempotencyKey: 'k-ds-create-2',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('chaindesk datasources.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /datasources/{datasourceId}', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        return jsonResponse({ deleted: true })
      }),
    )
    const result = await chaindeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'datasources.delete',
      args: { datasourceId: 'ds_1' },
      idempotencyKey: 'k-ds-delete-1',
    })
    expect(capturedMethod).toBe('DELETE')
    expect(capturedUrl).toBe('https://api.chaindesk.ai/api/datasources/ds_1')
    expect(result.status).toBe('committed')
  })
})

describe('chaindesk agents.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /agents with the supplied configuration', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input)
        capturedMethod = init?.method ?? ''
        capturedBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ id: 'agent_99' })
      }),
    )
    const result = await chaindeskConnector.executeMutation!({
      source: source(),
      capabilityName: 'agents.create',
      args: {
        name: 'Sales bot',
        description: 'Answers sales questions',
        modelName: 'gpt-4o-mini',
        prompt: 'Be helpful.',
        visibility: 'private',
      },
      idempotencyKey: 'k-agent-create-1',
    })
    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://api.chaindesk.ai/api/agents')
    expect(capturedBody).toEqual({
      name: 'Sales bot',
      description: 'Answers sales questions',
      modelName: 'gpt-4o-mini',
      prompt: 'Be helpful.',
      visibility: 'private',
    })
    expect(result.status).toBe('committed')
  })
})
