import { afterEach, describe, expect, it, vi } from 'vitest'
import { campaignMonitorConnector } from '../src/connectors/adapters/campaign-monitor.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_campaign_monitor_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'campaign-monitor',
    label: 'Campaign Monitor test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'cm_secret' },
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

describe('campaign-monitor adapter manifest', () => {
  it('classifies itself as the crm category and exposes the campaign-monitor kind', () => {
    expect(campaignMonitorConnector.manifest.kind).toBe('campaign-monitor')
    expect(campaignMonitorConnector.manifest.category).toBe('crm')
    expect(campaignMonitorConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = campaignMonitorConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('exposes the new campaign + list write capabilities', () => {
    const names = campaignMonitorConnector.manifest.capabilities.map((c) => c.name)
    for (const expected of [
      'subscriber.add',
      'subscriber.update',
      'subscriber.unsubscribe',
      'subscriber.find',
      'campaign.create',
      'campaign.send',
      'list.create',
      'list.delete',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const targets = ['campaign.create', 'campaign.send', 'list.create', 'list.delete']
    for (const name of targets) {
      const cap = campaignMonitorConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('campaign-monitor campaign.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v3.3/campaigns/{clientId}.json with the CM camelcase body shape', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse('cmp_123')
      }),
    )
    const result = await campaignMonitorConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.create',
      args: {
        clientId: 'client-1',
        name: 'June Newsletter',
        subject: 'Hi',
        fromName: 'Drew',
        fromEmail: 'drew@example.com',
        replyTo: 'drew@example.com',
        htmlUrl: 'https://cdn.example.com/email.html',
        textUrl: 'https://cdn.example.com/email.txt',
        listIDs: ['list-1'],
        segmentIDs: [],
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v3.3/campaigns/client-1.json')
    expect(requestBody).toMatchObject({
      Name: 'June Newsletter',
      Subject: 'Hi',
      FromName: 'Drew',
      ListIDs: ['list-1'],
    })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      campaignMonitorConnector.executeMutation!({
        source: source(),
        capabilityName: 'campaign.create',
        args: {
          clientId: 'client-1',
          name: 'x',
          subject: 'x',
          fromName: 'x',
          fromEmail: 'x@y.z',
          replyTo: 'x@y.z',
          htmlUrl: 'https://x',
          textUrl: 'https://x.txt',
          listIDs: ['l1'],
          segmentIDs: [],
        },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('campaign-monitor campaign.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v3.3/campaigns/{id}/send.json with confirmationEmail', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse('')
      }),
    )
    const result = await campaignMonitorConnector.executeMutation!({
      source: source(),
      capabilityName: 'campaign.send',
      args: { campaignId: 'cmp-1', confirmationEmail: 'ops@example.com', sendDate: 'Immediately' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v3.3/campaigns/cmp-1/send.json')
    expect(requestBody).toEqual({ ConfirmationEmail: 'ops@example.com', SendDate: 'Immediately' })
    expect(result.status).toBe('committed')
  })
})

describe('campaign-monitor list.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /api/v3.3/lists/{clientId}.json with the title', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse('list-9')
      }),
    )
    const result = await campaignMonitorConnector.executeMutation!({
      source: source(),
      capabilityName: 'list.create',
      args: {
        clientId: 'client-1',
        title: 'Beta testers',
        unsubscribePage: 'https://example.com/unsub',
        unsubscribeSetting: 'AllClientLists',
        confirmedOptIn: false,
        confirmationSuccessPage: 'https://example.com/confirm',
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/api/v3.3/lists/client-1.json')
    expect(requestBody).toMatchObject({ Title: 'Beta testers' })
    expect(result.status).toBe('committed')
  })
})

describe('campaign-monitor list.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /api/v3.3/lists/{listId}.json', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse('')
      }),
    )
    const result = await campaignMonitorConnector.executeMutation!({
      source: source(),
      capabilityName: 'list.delete',
      args: { listId: 'list-9' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/api/v3.3/lists/list-9.json')
    expect(result.status).toBe('committed')
  })
})
