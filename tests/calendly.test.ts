import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendlyConnector } from '../src/connectors/adapters/calendly.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_calendly_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'calendly',
    label: 'Calendly test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'cal_oauth_token' },
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

describe('calendly adapter manifest', () => {
  it('exposes the calendly kind in the calendar category', () => {
    expect(calendlyConnector.manifest.kind).toBe('calendly')
    expect(calendlyConnector.manifest.category).toBe('calendar')
  })

  it('marks the new write capabilities as native-idempotency external effect', () => {
    const caps = calendlyConnector.manifest.capabilities
    const targets = [
      'scheduling-links.delete',
      'webhooks.create',
      'webhooks.delete',
      'invitee.no-show.create',
    ]
    for (const name of targets) {
      const cap = caps.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') continue
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('calendly scheduling-links.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /scheduling_links/{uuid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({})
      }),
    )
    const result = await calendlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'scheduling-links.delete',
      args: { uuid: 'link-uuid-1' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/scheduling_links/link-uuid-1')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      calendlyConnector.executeMutation!({
        source: source(),
        capabilityName: 'scheduling-links.delete',
        args: { uuid: 'link-uuid-1' },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('calendly webhooks.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /webhook_subscriptions with url/events/scope body', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ resource: { uri: 'https://api.calendly.com/webhook_subscriptions/abc' } })
      }),
    )
    const result = await calendlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.create',
      args: {
        url: 'https://example.com/hook',
        events: ['invitee.created'],
        organization: 'https://api.calendly.com/organizations/org-uuid',
        user: 'https://api.calendly.com/users/user-uuid',
        scope: 'organization',
        signing_key: 'whsec_test',
      },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/webhook_subscriptions')
    expect(requestBody).toMatchObject({
      url: 'https://example.com/hook',
      events: ['invitee.created'],
      scope: 'organization',
    })
    expect(result.status).toBe('committed')
  })
})

describe('calendly webhooks.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('issues DELETE /webhook_subscriptions/{uuid}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        return jsonResponse({})
      }),
    )
    const result = await calendlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'webhooks.delete',
      args: { uuid: 'hook-1' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('/webhook_subscriptions/hook-1')
    expect(result.status).toBe('committed')
  })
})

describe('calendly invitee.no-show.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /invitee_no_shows with invitee uri', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = String(input)
        requestMethod = init?.method
        requestBody = init?.body ? JSON.parse(init.body as string) : null
        return jsonResponse({ resource: { uri: 'https://api.calendly.com/invitee_no_shows/abc' } })
      }),
    )
    const result = await calendlyConnector.executeMutation!({
      source: source(),
      capabilityName: 'invitee.no-show.create',
      args: { invitee: 'https://api.calendly.com/scheduled_events/E1/invitees/I1' },
      idempotencyKey: 'k-1',
    })
    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('/invitee_no_shows')
    expect(requestBody).toEqual({ invitee: 'https://api.calendly.com/scheduled_events/E1/invitees/I1' })
    expect(result.status).toBe('committed')
  })
})
