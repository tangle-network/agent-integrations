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
})
