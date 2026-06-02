import { afterEach, describe, expect, it, vi } from 'vitest'
import { googlechatConnector } from '../src/connectors/adapters/googlechat.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(overrides: Partial<ResolvedDataSource> = {}): ResolvedDataSource {
  return {
    id: 'src_gchat_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'googlechat',
    label: 'gchat test',
    consistencyModel: 'authoritative',
    scopes: ['https://www.googleapis.com/auth/chat.messages', 'https://www.googleapis.com/auth/chat.spaces'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'ya29_abc' },
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

describe('googlechat adapter manifest', () => {
  it('classifies itself as the comms category and exposes the googlechat kind', () => {
    expect(googlechatConnector.manifest.kind).toBe('googlechat')
    expect(googlechatConnector.manifest.category).toBe('comms')
    expect(googlechatConnector.manifest.defaultConsistencyModel).toBe('authoritative')
  })

  it('declares OAuth2 with the documented Google endpoints and env-var names', () => {
    const auth = googlechatConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(auth.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(auth.clientIdEnv).toBe('GOOGLE_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('GOOGLE_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.messages')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.spaces')
    expect(auth.scopes).toContain('https://www.googleapis.com/auth/chat.memberships')
  })

  it('covers the full activepieces action set plus write-side update/delete/space.create', () => {
    const names = googlechatConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'send.amessage',
        'get.direct.message.details',
        'add.aspace.member',
        'get.message.details',
        'search.messages',
        'find.member',
        'message.update',
        'message.delete',
        'space.create',
      ].sort(),
    )
    const reads = googlechatConnector.manifest.capabilities
      .filter((c) => c.class === 'read')
      .map((c) => c.name)
      .sort()
    const mutations = googlechatConnector.manifest.capabilities
      .filter((c) => c.class === 'mutation')
      .map((c) => c.name)
      .sort()
    expect(reads).toEqual(
      ['find.member', 'get.direct.message.details', 'get.message.details', 'search.messages'].sort(),
    )
    expect(mutations).toEqual(
      ['add.aspace.member', 'message.delete', 'message.update', 'send.amessage', 'space.create'].sort(),
    )
  })

  it('marks the new write-side mutations as native-idempotency + externalEffect=true', () => {
    for (const name of ['message.update', 'message.delete', 'space.create']) {
      const cap = googlechatConnector.manifest.capabilities.find((c) => c.name === name)
      expect(cap, `missing capability ${name}`).toBeDefined()
      if (!cap || cap.class !== 'mutation') throw new Error(`${name} must be a mutation`)
      expect(cap.cas).toBe('native-idempotency')
      expect(cap.externalEffect).toBe(true)
    }
  })
})

describe('googlechat space.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the Space resource to /v1/spaces', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    let requestBody: Record<string, unknown> | null = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      requestBody = init?.body ? JSON.parse(init.body as string) : null
      return jsonResponse({ name: 'spaces/AAA1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await googlechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'space.create',
      args: { space: { displayName: 'Engineering', spaceType: 'SPACE' } },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('POST')
    expect(String(requestUrl)).toBe('https://chat.googleapis.com/v1/spaces')
    expect(requestBody).toMatchObject({ displayName: 'Engineering', spaceType: 'SPACE' })
    expect(result.status).toBe('committed')
  })

  it('surfaces CredentialsExpired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    await expect(
      googlechatConnector.executeMutation!({
        source: source(),
        capabilityName: 'space.create',
        args: { space: { displayName: 'X', spaceType: 'SPACE' } },
        idempotencyKey: 'k-1',
      }),
    ).rejects.toMatchObject({ name: 'CredentialsExpired' })
  })
})

describe('googlechat message.delete', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('DELETEs /v1/{name}', async () => {
    let requestUrl: string | undefined
    let requestMethod: string | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input)
      requestMethod = init?.method
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await googlechatConnector.executeMutation!({
      source: source(),
      capabilityName: 'message.delete',
      args: { name: 'spaces/AAA/messages/BBB' },
      idempotencyKey: 'k-1',
    })

    expect(requestMethod).toBe('DELETE')
    // declarative-rest URL-encodes path segment substitutions, so the resource
    // name's '/' characters land as %2F in the final URL.
    expect(String(requestUrl)).toBe(
      'https://chat.googleapis.com/v1/spaces%2FAAA%2Fmessages%2FBBB',
    )
  })
})
