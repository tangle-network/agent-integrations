import { afterEach, describe, expect, it, vi } from 'vitest'
import { bettermodeConnector } from '../src/connectors/adapters/bettermode.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_bettermode_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'bettermode',
    label: 'Bettermode test',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'api-key', apiKey: 'bm-token' },
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

describe('bettermode adapter manifest', () => {
  it('classifies itself as the crm category and exposes the bettermode kind', () => {
    expect(bettermodeConnector.manifest.kind).toBe('bettermode')
    expect(bettermodeConnector.manifest.category).toBe('crm')
    expect(bettermodeConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('uses api-key auth (mirrors the activepieces piece auth shape)', () => {
    const auth = bettermodeConnector.manifest.auth
    expect(auth.kind).toBe('api-key')
  })

  it('covers the activepieces action set plus discussion edit/delete + member.invite + reply.create', () => {
    const names = bettermodeConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'badge.assign',
        'badge.revoke',
        'discussion.create',
        'discussion.delete',
        'discussion.update',
        'member.invite',
        'question.create',
        'reply.create',
      ].sort(),
    )
    const mutations = bettermodeConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(mutations.length).toBe(names.length)
  })

  it('marks new mutations as native-idempotency external effect', () => {
    const caps = bettermodeConnector.manifest.capabilities
    for (const name of ['discussion.update', 'discussion.delete', 'member.invite', 'reply.create']) {
      const cap = caps.find((c) => c.name === name)!
      expect(cap.class).toBe('mutation')
      if (cap.class !== 'mutation') return
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('bettermode discussion.update', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the updatePost GraphQL mutation with postId+title+content variables', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: { query?: string; variables?: Record<string, unknown> } = {}
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : {}
      return jsonResponse({ data: { updatePost: { id: 'p-1', slug: 'edited' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bettermodeConnector.executeMutation!({
      source: source(),
      capabilityName: 'discussion.update',
      args: { postId: 'p-1', title: 'New title', content: 'updated body' },
      idempotencyKey: 'k-upd-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toMatch(/api\.bettermode\.com\/?$/)
    expect(requestBody.query).toMatch(/UpdateDiscussion/)
    expect(requestBody.variables).toMatchObject({ postId: 'p-1', title: 'New title' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      bettermodeConnector.executeMutation!({
        source: source(),
        capabilityName: 'discussion.update',
        args: { postId: 'p-1', title: 'x', content: 'y' },
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('bettermode discussion.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the deletePost GraphQL mutation with the postId variable', async () => {
    let requestBody: { query?: string; variables?: Record<string, unknown> } = {}
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(init.body as string) : {}
      return jsonResponse({ data: { deletePost: { status: 'ok' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bettermodeConnector.executeMutation!({
      source: source(),
      capabilityName: 'discussion.delete',
      args: { postId: 'p-99' },
      idempotencyKey: 'k-del-1',
    })

    expect(requestBody.query).toMatch(/DeletePost/)
    expect(requestBody.variables).toEqual({ postId: 'p-99' })
    expect(result.status).toBe('committed')
  })
})

describe('bettermode member.invite', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the inviteMembers GraphQL mutation with the email variable', async () => {
    let requestBody: { query?: string; variables?: Record<string, unknown> } = {}
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(init.body as string) : {}
      return jsonResponse({ data: { inviteMembers: { id: 'inv-1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bettermodeConnector.executeMutation!({
      source: source(),
      capabilityName: 'member.invite',
      args: { email: 'new@example.com', roleId: 'role_member', spaceIds: ['sp_1'] },
      idempotencyKey: 'k-inv-1',
    })

    expect(requestBody.query).toMatch(/InviteMember/)
    expect(requestBody.variables).toMatchObject({ email: 'new@example.com' })
    expect(result.status).toBe('committed')
  })

  it('rejects when required `email` is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    await expect(
      bettermodeConnector.executeMutation!({
        source: source(),
        capabilityName: 'member.invite',
        args: {},
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow(/missing required argument: email/)
  })
})

describe('bettermode reply.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the createReply GraphQL mutation with postId+content variables', async () => {
    let requestBody: { query?: string; variables?: Record<string, unknown> } = {}
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(init.body as string) : {}
      return jsonResponse({ data: { createReply: { id: 'r-1' } } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await bettermodeConnector.executeMutation!({
      source: source(),
      capabilityName: 'reply.create',
      args: { postId: 'p-1', content: 'thanks!' },
      idempotencyKey: 'k-rep-1',
    })

    expect(requestBody.query).toMatch(/CreateReply/)
    expect(requestBody.variables).toMatchObject({ postId: 'p-1', content: 'thanks!' })
    expect(result.status).toBe('committed')
  })
})
