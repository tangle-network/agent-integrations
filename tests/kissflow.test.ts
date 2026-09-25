import { afterEach, describe, expect, it, vi } from 'vitest'
import { kissflowConnector } from '../src/connectors/adapters/kissflow.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_kissflow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'kissflow',
    label: 'Kissflow tenant',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { baseUrl: 'https://acme.kissflow.com' },
    credentials: {
      kind: 'api-key',
      apiKey: 'ak_test',
    },
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

describe('kissflow adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = kissflowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/kissflow/i)
  })

})

describe('kissflow process.instance.create', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /process/2/{accountId}/{processId} with the payload as the body', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ _id: 'PI_1', status: 'Draft' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kissflowConnector.executeMutation!({
      source: source(),
      capabilityName: 'process.instance.create',
      args: {
        accountId: 'ACME',
        processId: 'P_invoice',
        payload: { Title: 'Invoice 42', Amount: 100 },
      },
      idempotencyKey: 'idemp-create-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://acme.kissflow.com/process/2/ACME/P_invoice')
    expect(capturedBody).toEqual({ Title: 'Invoice 42', Amount: 100 })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.data).toEqual({ _id: 'PI_1', status: 'Draft' })
    expect(typeof result.committedAt).toBe('number')
    expect(result.idempotentReplay).toBe(false)
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.create',
        args: { processId: 'P', payload: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/accountId/)
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.create',
        args: { accountId: 'A', payload: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/processId/)
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.create',
        args: { accountId: 'A', processId: 'P' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/payload/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.create',
        args: { accountId: 'A', processId: 'P', payload: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.create',
        args: { accountId: 'A', processId: 'P', payload: {} },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('kissflow process.instance.submit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to /process/2/{accountId}/{processId}/{instanceId}/submit', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method ?? ''
      return jsonResponse({ _id: 'PI_1', status: 'In Progress' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await kissflowConnector.executeMutation!({
      source: source(),
      capabilityName: 'process.instance.submit',
      args: {
        accountId: 'ACME',
        processId: 'P_invoice',
        instanceId: 'PI_1',
      },
      idempotencyKey: 'idemp-submit-1',
    })

    expect(capturedMethod).toBe('POST')
    expect(capturedUrl).toBe('https://acme.kissflow.com/process/2/ACME/P_invoice/PI_1/submit')
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') throw new Error('unreachable')
    expect(result.data).toEqual({ _id: 'PI_1', status: 'In Progress' })
    expect(typeof result.committedAt).toBe('number')
    expect(result.idempotentReplay).toBe(false)
  })

  it('rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.submit',
        args: { processId: 'P', instanceId: 'PI' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/accountId/)
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.submit',
        args: { accountId: 'A', instanceId: 'PI' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/processId/)
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.submit',
        args: { accountId: 'A', processId: 'P' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/instanceId/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    )
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.submit',
        args: { accountId: 'A', processId: 'P', instanceId: 'PI' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  it('surfaces CredentialsExpired on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    await expect(
      kissflowConnector.executeMutation!({
        source: source(),
        capabilityName: 'process.instance.submit',
        args: { accountId: 'A', processId: 'P', instanceId: 'PI' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
