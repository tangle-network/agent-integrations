import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLinkedinConnector,
  linkedinConnector,
} from '../src/connectors/adapters/linkedin.js'
import type { ResolvedDataSource } from '../src/connectors/types.js'

function source(): ResolvedDataSource {
  return {
    id: 'src_linkedin_1',
    projectId: 'proj_1',
    publishedAgentId: null,
    kind: 'linkedin',
    label: 'LinkedIn test',
    consistencyModel: 'advisory',
    scopes: ['w_member_social'],
    metadata: {},
    credentials: { kind: 'oauth2', accessToken: 'linkedin-access-token' },
    status: 'active',
  }
}

describe('linkedin adapter manifest', () => {
  it('declares OAuth2 with the documented LinkedIn endpoints and env-var names', () => {
    const auth = linkedinConnector.manifest.auth
    expect(auth.kind).toBe('oauth2')
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.authorizationUrl).toBe('https://www.linkedin.com/oauth/v2/authorization')
    expect(auth.tokenUrl).toBe('https://www.linkedin.com/oauth/v2/accessToken')
    expect(auth.clientIdEnv).toBe('LINKEDIN_OAUTH_CLIENT_ID')
    expect(auth.clientSecretEnv).toBe('LINKEDIN_OAUTH_CLIENT_SECRET')
    expect(auth.scopes).toEqual(['openid', 'profile', 'email', 'w_member_social'])
  })

  it('exposes only self-serve member capabilities by default', () => {
    const names = linkedinConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'userinfo',
        'shares.create',
        'posts.create',
        'posts.delete',
        'comments.create',
        'comments.update',
        'comments.delete',
      ].sort(),
    )

    const declaredScopes = new Set(
      (linkedinConnector.manifest.auth.kind === 'oauth2'
        ? linkedinConnector.manifest.auth.scopes
        : []),
    )
    for (const capability of linkedinConnector.manifest.capabilities) {
      for (const scope of capability.requiredScopes ?? []) {
        expect(declaredScopes.has(scope), `${capability.name}: ${scope}`).toBe(true)
      }
    }
  })

  it('adds organization scopes and capabilities only when explicitly configured', () => {
    const organizationConnector = createLinkedinConnector({ organizationAccess: true })
    const auth = organizationConnector.manifest.auth
    if (auth.kind !== 'oauth2') throw new Error('unreachable')
    expect(auth.scopes).toEqual([
      'openid',
      'profile',
      'email',
      'w_member_social',
      'r_organization_social',
      'w_organization_social',
      'rw_organization_admin',
    ])

    const names = organizationConnector.manifest.capabilities.map((c) => c.name).sort()
    expect(names).toEqual(
      [
        'userinfo',
        'shares.create',
        'organizations.get',
        'organizations.acls.list',
        'posts.create',
        'posts.get',
        'posts.list.byAuthor',
        'posts.delete',
        'comments.list',
        'comments.create',
        'comments.update',
        'comments.delete',
        'socialActions.get',
      ].sort(),
    )

    const postsCreate = organizationConnector.manifest.capabilities.find(
      (capability) => capability.name === 'posts.create',
    )
    expect(postsCreate?.requiredScopes).toEqual(['w_organization_social'])
  })

})

describe('linkedin shares.create', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a published text share on the unversioned UGC Posts endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 201,
      headers: { 'X-RestLi-Id': 'urn:li:ugcPost:123' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await linkedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'shares.create',
      args: { author: 'urn:li:person:abc', text: 'Hello LinkedIn' },
      idempotencyKey: 'share-text-1',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [input, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(String(input)).toBe('https://api.linkedin.com/v2/ugcPosts')
    expect(init?.method).toBe('POST')
    expect(headers.get('authorization')).toBe('Bearer linkedin-access-token')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-restli-protocol-version')).toBe('2.0.0')
    expect(headers.has('linkedin-version')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({
      author: 'urn:li:person:abc',
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: 'Hello LinkedIn' },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    })
    expect(result).toMatchObject({
      status: 'committed',
      data: { id: 'urn:li:ugcPost:123' },
    })
  })

  it('creates an article share with optional card metadata and visibility', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 201,
      headers: { 'X-RestLi-Id': 'urn:li:share:456' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await linkedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'shares.create',
      args: {
        author: 'urn:li:person:abc',
        text: 'Read this',
        url: 'https://example.com/article',
        title: 'Example article',
        description: 'An example link card',
        visibility: 'CONNECTIONS',
      },
      idempotencyKey: 'share-article-1',
    })

    const [input, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(String(input)).toBe('https://api.linkedin.com/v2/ugcPosts')
    expect(init?.method).toBe('POST')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-restli-protocol-version')).toBe('2.0.0')
    expect(headers.has('linkedin-version')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual({
      author: 'urn:li:person:abc',
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: 'Read this' },
          shareMediaCategory: 'ARTICLE',
          media: [{
            status: 'READY',
            originalUrl: 'https://example.com/article',
            title: { text: 'Example article' },
            description: { text: 'An example link card' },
          }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'CONNECTIONS' },
    })
  })

  it('preserves braces in user-authored share fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, {
      status: 201,
      headers: { 'X-RestLi-Id': 'urn:li:share:braces' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await linkedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'shares.create',
      args: {
        author: 'urn:li:person:abc',
        text: 'Hello {world} from {author}',
        url: 'https://example.com/{article}',
        title: 'Launch {title}',
        description: 'About {author}',
      },
      idempotencyKey: 'share-braces-1',
    })

    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init?.body))
    expect(body.specificContent['com.linkedin.ugc.ShareContent']).toEqual({
      shareCommentary: { text: 'Hello {world} from {author}' },
      shareMediaCategory: 'ARTICLE',
      media: [{
        status: 'READY',
        originalUrl: 'https://example.com/{article}',
        title: { text: 'Launch {title}' },
        description: { text: 'About {author}' },
      }],
    })
  })

  it.each(['author', 'text'])('rejects a missing %s before fetch', async (missing) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const args: Record<string, unknown> = {
      author: 'urn:li:person:abc',
      text: 'Hello LinkedIn',
    }
    delete args[missing]

    await expect(linkedinConnector.executeMutation!({
      source: source(),
      capabilityName: 'shares.create',
      args,
      idempotencyKey: `share-missing-${missing}`,
    })).rejects.toThrow(`missing required argument: ${missing}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
