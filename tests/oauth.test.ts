import { describe, expect, it, vi } from 'vitest'
import { exchangeAuthorizationCode, refreshAccessToken } from '../src/index.js'

describe('OAuth token helpers', () => {
  it('exchanges authorization codes through an injected fetch implementation', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('client_id')).toBe('client')
      expect(body.get('client_secret')).toBe('secret')
      expect(body.get('code')).toBe('code')
      expect(body.get('redirect_uri')).toBe('https://app.example/callback')
      expect(body.get('code_verifier')).toBe('verifier')
      return Response.json({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        scope: 'calendar.read',
        token_type: 'Bearer',
      })
    }) as typeof fetch

    const tokens = await exchangeAuthorizationCode({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'client',
      clientSecret: 'secret',
      code: 'code',
      codeVerifier: 'verifier',
      redirectUri: 'https://app.example/callback',
      fetchImpl,
      signal: AbortSignal.timeout(15_000),
    })

    expect(fetchImpl).toHaveBeenCalledWith('https://oauth.example/token', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    }))
    expect(tokens).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      scope: 'calendar.read',
      tokenType: 'Bearer',
    })
  })

  it('refreshes access tokens through an injected fetch implementation', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = init?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('client_id')).toBe('client')
      expect(body.get('client_secret')).toBe('secret')
      expect(body.get('refresh_token')).toBe('refresh')
      return Response.json({
        access_token: 'next-access',
        expires_in: 900,
      })
    }) as typeof fetch

    const tokens = await refreshAccessToken({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(tokens).toEqual({
      accessToken: 'next-access',
      refreshToken: undefined,
      expiresIn: 900,
      scope: undefined,
      tokenType: undefined,
    })
  })

  it('exchanges a public-client code with client_id and no client secret', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      const body = init?.body as URLSearchParams
      expect(headers.authorization).toBeUndefined()
      expect(body.get('client_id')).toBe('public-client')
      expect(body.has('client_secret')).toBe(false)
      expect(body.get('code_verifier')).toBe('verifier')
      return Response.json({ access_token: 'access' })
    }) as typeof fetch

    await exchangeAuthorizationCode({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'public-client',
      clientSecret: 'must-not-send',
      tokenClientAuthMethod: 'none',
      code: 'code',
      codeVerifier: 'verifier',
      redirectUri: 'https://app.example/callback',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('refreshes a public client with client_id and no client secret', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      const body = init?.body as URLSearchParams
      expect(headers.authorization).toBeUndefined()
      expect(body.get('client_id')).toBe('public-client')
      expect(body.has('client_secret')).toBe(false)
      expect(body.get('refresh_token')).toBe('refresh')
      return Response.json({ access_token: 'next-access' })
    }) as typeof fetch

    await refreshAccessToken({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'public-client',
      clientSecret: 'must-not-send',
      tokenClientAuthMethod: 'none',
      refreshToken: 'refresh',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each([
    ['exchange', 'client_secret_post'],
    ['exchange', 'client_secret_basic'],
    ['refresh', 'client_secret_post'],
    ['refresh', 'client_secret_basic'],
  ] as const)('fails before network access when %s uses %s without a secret', async (operation, method) => {
    const fetchImpl = vi.fn() as typeof fetch
    const promise = operation === 'exchange'
      ? exchangeAuthorizationCode({
          tokenUrl: 'https://oauth.example/token',
          clientId: 'confidential-client',
          tokenClientAuthMethod: method,
          code: 'code',
          codeVerifier: 'verifier',
          redirectUri: 'https://app.example/callback',
          fetchImpl,
        })
      : refreshAccessToken({
          tokenUrl: 'https://oauth.example/token',
          clientId: 'confidential-client',
          tokenClientAuthMethod: method,
          refreshToken: 'refresh',
          fetchImpl,
        })

    await expect(promise).rejects.toThrow(/requires a client secret/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('omits code_verifier when the provider rejects PKCE', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = init?.body as URLSearchParams
      expect(body.has('code_verifier')).toBe(false)
      return Response.json({ access_token: 'access' })
    }) as typeof fetch

    await exchangeAuthorizationCode({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'client',
      clientSecret: 'secret',
      code: 'code',
      pkce: 'unsupported',
      redirectUri: 'https://app.example/callback',
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('fails before network access when PKCE requires a missing verifier', async () => {
    const fetchImpl = vi.fn() as typeof fetch

    await expect(exchangeAuthorizationCode({
      tokenUrl: 'https://oauth.example/token',
      clientId: 'client',
      clientSecret: 'secret',
      code: 'code',
      redirectUri: 'https://app.example/callback',
      fetchImpl,
    })).rejects.toThrow(/requires a PKCE code_verifier/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
