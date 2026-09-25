import { afterEach, describe, expect, it, vi } from 'vitest'
import { serviceNowConnector } from '../src/connectors/adapters/service-now.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_servicenow_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'service-now',
    label: 'service-now test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: { instanceUrl: 'https://acme.service-now.com' },
    credentials: { kind: 'api-key', apiKey: 'snow_secret' },
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

describe('service-now adapter manifest', () => {
  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = serviceNowConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/ServiceNow/i)
  })

})

describe('service-now incidents.close', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes the incident with state=7 (Closed) and close metadata', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ result: { sys_id: 'inc1', state: '7' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await serviceNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'incidents.close',
      args: {
        incidentSysSysId: 'abc123',
        closeCode: 'Solved (Permanently)',
        closeNotes: 'Root cause: DNS misconfig. Fixed.',
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('/api/now/v2/table/incident/abc123')
    expect(requestBody).toBeDefined()
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.state).toBe('7')
    expect(parsed.incident_state).toBe('7')
    expect(parsed.close_code).toBe('Solved (Permanently)')
    expect(parsed.close_notes).toBe('Root cause: DNS misconfig. Fixed.')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      serviceNowConnector.executeMutation!({
        source: source(),
        capabilityName: 'incidents.close',
        args: {
          incidentSysSysId: 'abc123',
          closeCode: 'cc',
          closeNotes: 'notes',
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('service-now incidents.assign', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes the incident and forwards assignedTo / assignmentGroup via args body', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ result: { sys_id: 'inc1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await serviceNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'incidents.assign',
      args: {
        incidentSysSysId: 'abc123',
        assignedTo: 'user_sys_id_1',
        assignmentGroup: 'group_sys_id_1',
      },
      idempotencyKey: 'k-1',
    })
    expect(String(requestUrl)).toContain('/api/now/v2/table/incident/abc123')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.assignedTo).toBe('user_sys_id_1')
    expect(parsed.assignmentGroup).toBe('group_sys_id_1')
  })
})

describe('service-now changes.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to /table/change_request with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ result: { sys_id: 'chg1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await serviceNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'changes.create',
      args: {
        fields: {
          short_description: 'Upgrade Snowflake driver',
          type: 'standard',
          risk: '3',
        },
      },
      idempotencyKey: 'k-1',
    })
    expect(result.status).toBe('committed')
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/now/v2/table/change_request')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.short_description).toBe('Upgrade Snowflake driver')
    expect(parsed.type).toBe('standard')
  })
})

describe('service-now tasks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs to the requested task table with the supplied fields', async () => {
    let requestUrl: string | undefined
    let requestBody: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse({ result: { sys_id: 'tsk1' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await serviceNowConnector.executeMutation!({
      source: source(),
      capabilityName: 'tasks.create',
      args: {
        table: 'sc_task',
        fields: {
          short_description: 'Provision laptop',
          assigned_to: 'user_sys_id_1',
        },
      },
      idempotencyKey: 'k-1',
    })
    expect(String(requestUrl)).toContain('/api/now/v2/table/sc_task')
    const parsed = JSON.parse(requestBody!) as Record<string, unknown>
    expect(parsed.short_description).toBe('Provision laptop')
  })
})
