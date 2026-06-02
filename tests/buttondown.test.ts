import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttondownConnector } from '../src/connectors/adapters/buttondown.js'
import type { ResolvedDataSource } from '../src/connectors/index'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_buttondown_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'buttondown',
    label: 'Buttondown test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bd-secret' },
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

describe('buttondown adapter manifest', () => {
  it('classifies itself as the crm category and exposes the buttondown kind', () => {
    expect(buttondownConnector.manifest.kind).toBe('buttondown')
    expect(buttondownConnector.manifest.category).toBe('crm')
    expect(buttondownConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares api-key auth with a vendor-specific hint', () => {
    const auth = buttondownConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
    if (auth.kind !== 'api-key') throw new Error('unreachable')
    expect(auth.hint).toMatch(/Buttondown/i)
  })

  it('covers subscribers CRUD plus email draft + send capability surface', () => {
    const names = buttondownConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'subscribers.create',
        'subscribers.delete',
        'subscribers.list',
        'subscribers.send_email',
        'subscribers.update',
        'emails.create',
        'emails.send',
      ].sort(),
    )
    const mutations = buttondownConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations).toEqual(
      [
        'emails.create',
        'emails.send',
        'subscribers.create',
        'subscribers.delete',
        'subscribers.send_email',
        'subscribers.update',
      ].sort(),
    )
  })

  it('marks every mutation with native-idempotency CAS and external effect', () => {
    for (const c of buttondownConnector.manifest.capabilities) {
      if (c.class !== 'mutation') continue
      expect(c.cas).toBe('native-idempotency')
      expect(c.externalEffect).toBe(true)
    }
  })
})

describe('buttondown subscribers.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('PATCHes /v1/subscribers/{id} with merged metadata', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'sub-1', notes: 'updated' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await buttondownConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.update',
      args: {
        subscriberId: 'sub-1',
        email: 'a@b.test',
        type: 'regular',
        notes: 'updated',
        tags: ['vip'],
        metadata: { tier: 'gold' },
      },
      idempotencyKey: 'k-update-1',
    })

    expect(requestMethod).toBe('PATCH')
    expect(String(requestUrl)).toContain('https://api.buttondown.email/v1/subscribers/sub-1')
    expect(requestBody).toMatchObject({ notes: 'updated', tags: ['vip'] })
    expect(result.status).toBe('committed')
  })

  it('rejects when subscriberId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      buttondownConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.update',
        args: { notes: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/subscriberId/)
  })
})

describe('buttondown subscribers.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/subscribers/{id}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ deleted: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await buttondownConnector.executeMutation!({
      source: source(),
      capabilityName: 'subscribers.delete',
      args: { subscriberId: 'sub-1' },
      idempotencyKey: 'k-delete-1',
    })

    expect(requestMethod).toBe('DELETE')
    expect(String(requestUrl)).toContain('https://api.buttondown.email/v1/subscribers/sub-1')
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(
      buttondownConnector.executeMutation!({
        source: source(),
        capabilityName: 'subscribers.delete',
        args: { subscriberId: 'sub-1' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('buttondown emails.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/emails with subject and body for a draft', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: unknown
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ id: 'email-1', status: 'draft' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await buttondownConnector.executeMutation!({
      source: source(),
      capabilityName: 'emails.create',
      args: {
        subject: 'Hello',
        body: '<p>Hi</p>',
        status: 'draft',
        publishDate: '2026-06-10T15:00:00Z',
      },
      idempotencyKey: 'k-draft-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://api.buttondown.email/v1/emails')
    expect(requestBody).toMatchObject({ subject: 'Hello', body: '<p>Hi</p>' })
    expect(result.status).toBe('committed')
  })

  it('rejects when subject is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      buttondownConnector.executeMutation!({
        source: source(),
        capabilityName: 'emails.create',
        args: { body: 'x' },
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/subject/)
  })
})

describe('buttondown emails.send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs /v1/emails/{emailId}/send', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({ id: 'email-1', status: 'sent' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await buttondownConnector.executeMutation!({
      source: source(),
      capabilityName: 'emails.send',
      args: { emailId: 'email-1' },
      idempotencyKey: 'k-send-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toContain('https://api.buttondown.email/v1/emails/email-1/send')
    expect(result.status).toBe('committed')
  })

  it('rejects when emailId is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      buttondownConnector.executeMutation!({
        source: source(),
        capabilityName: 'emails.send',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/emailId/)
  })
})
