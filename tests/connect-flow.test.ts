import { describe, expect, it, vi } from 'vitest'
import {
  finishConnectFlow,
  InMemoryConnectStateStore,
  revokeConnectFlow,
  startConnectFlow,
} from '../src/connect/index'
import { TangleIdentityUnreachableError } from '../src/connectors/adapters/tangle-id'

describe('startConnectFlow', () => {
  it('builds an authorizeUrl pointing at /cross-site/authorize with app + state', () => {
    const out = startConnectFlow({}, { appId: 'evals', state: 's1' })
    const url = new URL(out.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://id.tangle.tools/cross-site/authorize')
    expect(url.searchParams.get('app')).toBe('evals')
    expect(url.searchParams.get('state')).toBe('s1')
  })

  it('threads through an optional redirect param', () => {
    const out = startConnectFlow(
      { baseUrl: 'https://id.example.com' },
      { appId: 'tax', state: 's1', redirectUri: 'https://tax.example.com/cb' },
    )
    const url = new URL(out.authorizeUrl)
    expect(url.origin).toBe('https://id.example.com')
    expect(url.searchParams.get('redirect')).toBe('https://tax.example.com/cb')
  })

  it('refuses to mint a URL without a CSRF state', () => {
    expect(() => startConnectFlow({}, { appId: 'evals', state: '' })).toThrow(
      /state is required/,
    )
  })

  it('refuses to mint a URL without an appId', () => {
    expect(() => startConnectFlow({}, { appId: '', state: 's' })).toThrow(/appId is required/)
  })
})

describe('finishConnectFlow', () => {
  it('POSTs /cross-site/exchange with code+app and returns the minted key + user', async () => {
    let capturedUrl = ''
    let capturedBody: unknown
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({
          apiKey: 'sk-tan-mintkey',
          keyId: 'key_1',
          paidAccessPolicyVersion: 1,
          emailVerified: true,
          user: { id: 'usr_1', email: 'a@company.com', name: 'A B', image: null },
          balance: 0,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const out = await finishConnectFlow(
      { baseUrl: 'https://id.example.com', fetchImpl },
      { code: 'c1', appId: 'evals' },
    )
    expect(capturedUrl).toBe('https://id.example.com/cross-site/exchange')
    expect(capturedBody).toEqual({ code: 'c1', app: 'evals' })
    expect(out).toEqual({
      apiKey: 'sk-tan-mintkey',
      keyId: 'key_1',
      user: { id: 'usr_1', email: 'a@company.com', emailVerified: true, name: 'A B', image: null },
      balance: 0,
      paidAccessPolicyVersion: 1,
    })
  })

  it('accepts the exact Platform exchange contract without a nested verification field', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        apiKey: 'sk-tan-k',
        keyId: 'key_1',
        paidAccessPolicyVersion: 1,
        emailVerified: true,
        user: { id: 'u', email: 'person@company.com' },
        balance: 0,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const out = await finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' })
    expect(out.balance).toBe(0)
  })

  it('rejects an exchange for an unverified human before returning the company key', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ apiKey: 'sk-tan-k', user: { id: 'u', emailVerified: false } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects an exchange when the platform omits email verification', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ apiKey: 'sk-tan-k', user: { id: 'u' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(
      finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('accepts top-level email verification because that is the shared Platform contract', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        apiKey: 'sk-tan-k',
        keyId: 'key_1',
        paidAccessPolicyVersion: 1,
        emailVerified: true,
        user: { id: 'u', email: 'person@company.com' },
        balance: 0,
      }), { status: 200 }),
    )
    await expect(finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }))
      .resolves.toMatchObject({ apiKey: 'sk-tan-k', user: { id: 'u', emailVerified: true } })
  })

  it('throws Unreachable on 401 from /cross-site/exchange (replay / expired code)', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad', { status: 401 }))
    await expect(
      finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }),
    ).rejects.toBeInstanceOf(TangleIdentityUnreachableError)
  })

  it('accepts a secret-free replay and returns the stable key id', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({
        keyId: 'key_replay',
        paidAccessPolicyVersion: 1,
        emailVerified: true,
        user: { id: 'u', email: 'person@company.com' },
        balance: 0,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' })).resolves.toEqual({
      keyId: 'key_replay',
      user: { id: 'u', email: 'person@company.com', emailVerified: true },
      balance: 0,
      paidAccessPolicyVersion: 1,
    })
  })

  it('throws Unreachable on malformed response missing the stable key id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      apiKey: 'sk-tan-k',
      paidAccessPolicyVersion: 1,
      emailVerified: true,
      user: { id: 'u', email: 'person@company.com' },
      balance: 0,
    }), { status: 200 }))
    await expect(finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }))
      .rejects.toBeInstanceOf(TangleIdentityUnreachableError)
  })

  it('rejects a non-sk-tan exchange key even when the rest of the response looks valid', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      apiKey: 'pk-live-not-a-tangle-key',
      keyId: 'key_1',
      paidAccessPolicyVersion: 1,
      emailVerified: true,
      user: { id: 'u', email: 'person@company.com' },
      balance: 0,
    }), { status: 200 }))
    await expect(finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('rejects a broker token at the user-key exchange boundary', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      apiKey: 'sk-tan-broker-not-a-user-key',
      keyId: 'key_1',
      paidAccessPolicyVersion: 1,
      emailVerified: true,
      user: { id: 'u', email: 'person@company.com' },
      balance: 0,
    }), { status: 200 }))
    await expect(finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('throws Unreachable on network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('econnrefused')
    })
    await expect(
      finishConnectFlow({ fetchImpl }, { code: 'c', appId: 'a' }),
    ).rejects.toBeInstanceOf(TangleIdentityUnreachableError)
  })

  it('requires both code and appId', async () => {
    await expect(finishConnectFlow({}, { code: '', appId: 'x' })).rejects.toThrow(/code is required/)
    await expect(finishConnectFlow({}, { code: 'x', appId: '' })).rejects.toThrow(/appId is required/)
  })
})

describe('revokeConnectFlow', () => {
  it('routes API keys through the identity client revoke path (verify + DELETE)', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      seen.push(`${init?.method ?? 'GET'} ${url.split('/').slice(3).join('/')}`)
      if (url.endsWith('/v1/keys/verify')) {
        return new Response(JSON.stringify({
          valid: true,
          userId: 'u',
          ownerId: 'u',
          ownerType: 'user',
          keyId: 'k1',
          name: 'User key',
          provisionedByService: 'user',
          emailVerified: true,
          servicePrincipal: false,
          email: 'owner@company.com',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(null, { status: 204 })
    })
    await revokeConnectFlow({ serviceToken: 'svc_x', serviceName: 'test-suite', fetchImpl }, { apiKey: 'sk-tan-x' })
    expect(seen).toEqual(['POST v1/keys/verify', 'DELETE v1/keys/k1'])
  })

  it('rejects empty apiKey', async () => {
    await expect(revokeConnectFlow({}, { apiKey: '' })).rejects.toThrow(/apiKey is required/)
  })
})

describe('InMemoryConnectStateStore', () => {
  it('round-trips a single put/consume', () => {
    const store = new InMemoryConnectStateStore()
    store.put('state-1', { appId: 'evals' })
    expect(store.consume('state-1')).toEqual({ appId: 'evals' })
    // Second consume is one-shot — protects against replay.
    expect(store.consume('state-1')).toBeUndefined()
  })

  it('expires entries past their TTL', () => {
    const store = new InMemoryConnectStateStore()
    store.put('s', { appId: 'a', ttlMs: -1 })
    expect(store.consume('s')).toBeUndefined()
  })

  it('clear drops every entry', () => {
    const store = new InMemoryConnectStateStore()
    store.put('a', { appId: 'a' })
    store.put('b', { appId: 'b' })
    store.clear()
    expect(store.consume('a')).toBeUndefined()
    expect(store.consume('b')).toBeUndefined()
  })
})
