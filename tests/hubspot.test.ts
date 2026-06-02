import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hubspot,
  type ResolvedDataSource,
} from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_hubspot_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'hubspot',
    label: 'Drew HubSpot',
    consistencyModel: 'authoritative',
    scopes: ['crm.objects.contacts.read', 'crm.objects.contacts.write'],
    metadata: {},
    credentials: {
      kind: 'oauth2',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: Date.now() + 60 * 60 * 1000,
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

describe('hubspot adapter', () => {
  const adapter = hubspot({ clientId: 'cid', clientSecret: 'sec', includeWriteScope: true })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('manifest exposes the deal + ticket write capabilities', () => {
    const names = adapter.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual([
      'create_deal',
      'create_note',
      'create_ticket',
      'find_contact',
      'update_deal_stage',
      'upsert_contact',
    ])
  })

  // create_deal --------------------------------------------------------------

  it('create_deal POSTs /crm/v3/objects/deals with properties and threads idempotency-key', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: any = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined))
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'deal-1',
        properties: { dealname: 'Big Deal', amount: '1000', dealstage: 'qualifiedtobuy' },
        createdAt: '2026-06-02T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_deal',
      args: {
        properties: {
          dealname: 'Big Deal',
          amount: '1000',
          dealstage: 'qualifiedtobuy',
          pipeline: 'default',
          closedate: '2026-12-31T00:00:00Z',
        },
        associations: { contactIds: ['c1', 'c2'] },
      },
      idempotencyKey: 'idemp-deal-1',
    })

    expect(capturedUrl).toBe('https://api.hubapi.com/crm/v3/objects/deals')
    expect(capturedMethod).toBe('POST')
    expect(capturedHeaders['x-tangle-idempotency-key']).toBe('idemp-deal-1')
    expect(capturedBody.properties).toMatchObject({
      dealname: 'Big Deal',
      amount: '1000',
      dealstage: 'qualifiedtobuy',
      pipeline: 'default',
      closedate: '2026-12-31T00:00:00Z',
    })
    expect(capturedBody.associations).toHaveLength(2)
    expect(capturedBody.associations[0]).toMatchObject({
      to: { id: 'c1' },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { dealId: string }).dealId).toBe('deal-1')
    }
  })

  it('create_deal rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_deal',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`properties` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_deal',
        args: { properties: { amount: '100' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`properties.dealname` is required/)
  })

  it('create_deal surfaces CredentialsExpired on 401/403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'forbidden' }),
      text: async () => 'forbidden',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_deal',
        args: { properties: { dealname: 'X' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // update_deal_stage --------------------------------------------------------

  it('update_deal_stage PATCHes /crm/v3/objects/deals/{dealId} with the new stage', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    let capturedBody: any = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'deal-42',
        properties: { dealstage: 'closedwon' },
        updatedAt: '2026-06-02T01:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'update_deal_stage',
      args: { dealId: 'deal-42', dealstage: 'closedwon' },
      idempotencyKey: 'idemp-stage-1',
    })

    expect(capturedUrl).toBe('https://api.hubapi.com/crm/v3/objects/deals/deal-42')
    expect(capturedMethod).toBe('PATCH')
    expect(capturedBody).toEqual({ properties: { dealstage: 'closedwon' } })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { dealId: string; dealstage: string }).dealId).toBe('deal-42')
      expect((result.data as { dealId: string; dealstage: string }).dealstage).toBe('closedwon')
    }
  })

  it('update_deal_stage rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_deal_stage',
        args: { dealstage: 'closedwon' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`dealId` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_deal_stage',
        args: { dealId: 'd1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`dealstage` is required/)
  })

  it('update_deal_stage surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'unauthorized' }),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'update_deal_stage',
        args: { dealId: 'd1', dealstage: 'closedwon' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })

  // create_ticket ------------------------------------------------------------

  it('create_ticket POSTs /crm/v3/objects/tickets with properties', async () => {
    let capturedUrl: string | null = null
    let capturedMethod: string | undefined
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: any = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedMethod = init?.method
      capturedHeaders = Object.fromEntries(new Headers(init?.headers as HeadersInit | undefined))
      capturedBody = JSON.parse(init!.body as string)
      return jsonResponse({
        id: 'tkt-7',
        properties: {
          subject: 'Help me',
          content: 'I need assistance',
          hs_pipeline_stage: '1',
          hs_ticket_priority: 'HIGH',
        },
        createdAt: '2026-06-02T00:00:00Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await adapter.executeMutation!({
      source: source(),
      capabilityName: 'create_ticket',
      args: {
        properties: {
          subject: 'Help me',
          content: 'I need assistance',
          hs_pipeline_stage: '1',
          hs_ticket_priority: 'HIGH',
        },
      },
      idempotencyKey: 'idemp-tkt-1',
    })

    expect(capturedUrl).toBe('https://api.hubapi.com/crm/v3/objects/tickets')
    expect(capturedMethod).toBe('POST')
    expect(capturedHeaders['x-tangle-idempotency-key']).toBe('idemp-tkt-1')
    expect(capturedBody.properties).toMatchObject({
      subject: 'Help me',
      content: 'I need assistance',
      hs_pipeline_stage: '1',
      hs_ticket_priority: 'HIGH',
    })
    expect(result.status).toBe('committed')
    if (result.status === 'committed') {
      expect((result.data as { ticketId: string }).ticketId).toBe('tkt-7')
    }
  })

  it('create_ticket rejects missing required args', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_ticket',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`properties` is required/)
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_ticket',
        args: { properties: { content: 'orphan body' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/`properties.subject` is required/)
  })

  it('create_ticket surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'unauthorized' }),
      text: async () => 'unauthorized',
    })))
    await expect(
      adapter.executeMutation!({
        source: source(),
        capabilityName: 'create_ticket',
        args: { properties: { subject: 'X' } },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})
