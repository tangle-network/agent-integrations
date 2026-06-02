import { afterEach, describe, expect, it, vi } from 'vitest'
import { knockConnector } from '../src/connectors/adapters/knock.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_knock_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'knock',
    label: 'Knock test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'knock_secret' },
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

describe('knock adapter manifest', () => {
  it('classifies itself as the comms category and exposes the knock kind', () => {
    expect(knockConnector.manifest.kind).toBe('knock')
    expect(knockConnector.manifest.category).toBe('comms')
    expect(knockConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth as documented in the catalog', () => {
    const auth = knockConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the full activepieces action set plus workflows.cancel', () => {
    const names = knockConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'workflows.trigger',
        'workflows.cancel',
        'users.identify',
        'users.get',
        'users.delete',
        'messages.get',
        'messages.list',
      ].sort(),
    )
    const reads = knockConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = knockConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(['messages.get', 'messages.list', 'users.get'].sort())
    expect(mutations).toEqual(
      ['users.delete', 'users.identify', 'workflows.cancel', 'workflows.trigger'].sort(),
    )
  })

  it('marks workflows.cancel native-idempotency + externalEffect', () => {
    const cancel = knockConnector.manifest.capabilities.find((c) => c.name === 'workflows.cancel')
    expect(cancel).toBeDefined()
    expect(cancel!.class).toBe('mutation')
    if (cancel!.class !== 'mutation') return
    expect(cancel!.cas).toBe('native-idempotency')
    expect(cancel!.externalEffect).toBe(true)
  })
})

describe('knock workflows.cancel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/workflows/{key}/cancel with cancellation_key body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ status: 'cancelled' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await knockConnector.executeMutation!({
      source: source(),
      capabilityName: 'workflows.cancel',
      args: {
        workflowKey: 'invoice-reminder',
        cancellationKey: 'inv-123',
        recipients: ['user_1', 'user_2'],
      },
      idempotencyKey: 'idemp-cancel-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/v1/workflows/invoice-reminder/cancel')
    expect(requestBody).toMatchObject({
      cancellation_key: 'inv-123',
      recipients: ['user_1', 'user_2'],
    })
    expect(result.status).toBe('committed')
  })

  it('rejects when required `workflowKey` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      knockConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflows.cancel',
        args: { cancellationKey: 'inv-123' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: workflowKey/)
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      knockConnector.executeMutation!({
        source: source(),
        capabilityName: 'workflows.cancel',
        args: {
          workflowKey: 'invoice-reminder',
          cancellationKey: 'inv-123',
          recipients: ['user_1'],
        },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
