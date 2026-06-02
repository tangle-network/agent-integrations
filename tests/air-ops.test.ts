import { afterEach, describe, expect, it, vi } from 'vitest'
import { airOpsConnector } from '../src/connectors/adapters/air-ops.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_air-ops_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'air-ops',
    label: 'air-ops test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'airops_secret' },
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

describe('air-ops adapter manifest', () => {
  it('classifies itself as other and exposes the air-ops kind', () => {
    expect(airOpsConnector.manifest.kind).toBe('air-ops')
    expect(airOpsConnector.manifest.category).toBe('other')
    expect(airOpsConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth as the catalog declares', () => {
    const auth = airOpsConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/AirOps/i)
  })

  it('covers the run / async-run / get-execution / cancel / publish / update action surface', () => {
    const names = airOpsConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'cancel.execution',
        'get.execution',
        'run.workflow',
        'run.workflow.async',
        'workflow.publish',
        'workflow.update',
      ].sort(),
    )
    const reads = airOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = airOpsConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['get.execution'])
    expect(mutations).toEqual(
      [
        'cancel.execution',
        'run.workflow',
        'run.workflow.async',
        'workflow.publish',
        'workflow.update',
      ].sort(),
    )
  })

  it('marks every mutation as native-idempotency + externalEffect=true', () => {
    const mutations = airOpsConnector.manifest.capabilities.filter((c) => c.class === 'mutation')
    for (const cap of mutations) {
      if (cap.class !== 'mutation') throw new Error('narrowing')
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('air-ops cancel.execution', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /airops_apps/{app}/executions/{execution_uuid}/cancel with bearer auth', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let authHeader: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      const headers = init?.headers as Record<string, string> | undefined
      authHeader = headers?.authorization
      return jsonResponse({ status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await airOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'cancel.execution',
      args: { app: 'app_uuid_1', execution_uuid: 'exec_uuid_1' },
      idempotencyKey: 'k-cancel-1',
    })

    expect(requestMethod).toBe('POST')
    expect(requestUrl).toBe(
      'https://app.airops.com/public_api/airops_apps/app_uuid_1/executions/exec_uuid_1/cancel',
    )
    expect(authHeader).toBe('Bearer airops_secret')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      airOpsConnector.executeMutation!({
        source: source(),
        capabilityName: 'cancel.execution',
        args: { app: 'app_uuid_1', execution_uuid: 'exec_uuid_1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('air-ops workflow.publish', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /airops_apps/{app}/publish', async () => {
    let requestUrl: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = String(input)
      return jsonResponse({ published: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await airOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflow.publish',
      args: { app: 'app_uuid_2' },
      idempotencyKey: 'k',
    })

    expect(requestUrl).toBe('https://app.airops.com/public_api/airops_apps/app_uuid_2/publish')
  })
})

describe('air-ops workflow.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /airops_apps/{app} with the partial workflow body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'app_uuid_3' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await airOpsConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflow.update',
      args: {
        app: 'app_uuid_3',
        name: 'New Name',
        description: 'updated',
        inputs_schema: {},
        definition: {},
      },
      idempotencyKey: 'k',
    })

    expect(requestMethod).toBe('PATCH')
    expect(requestUrl).toBe('https://app.airops.com/public_api/airops_apps/app_uuid_3')
    expect(requestBody).toMatchObject({ name: 'New Name', description: 'updated' })
  })
})
