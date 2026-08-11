import { describe, expect, it, vi } from 'vitest'
import {
  exchangeAuthorizationCode,
  redactOAuthSensitiveText,
  refreshAccessToken,
} from '../src/index.js'

const FORM_CLIENT_ID = 'client id:✓'
const FORM_CLIENT_SECRET = 's e+c%r:et'
const FORM_CODE = 'code +%:✓'
const FORM_VERIFIER = 'verifier +%:✓'
const FORM_REFRESH_TOKEN = 'refresh +%:✓'
const JSON_ESCAPED_SECRET = 's"e\\c\nret'
const FORM_ENCODED_SECRET = 's+e%2Bc%25r%3Aet'
const FORM_DECODED_BASIC = 'client+id%3A%E2%9C%93:s+e%2Bc%25r%3Aet'
const FORM_BASIC_PAYLOAD = Buffer.from(FORM_DECODED_BASIC).toString('base64')
const FORM_AUTHORIZATION = `Basic ${FORM_BASIC_PAYLOAD}`

function formEncode(value: string): string {
  return new URLSearchParams({ value }).toString().slice('value='.length)
}

function lowercasePercentEscapes(value: string): string {
  return value.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase())
}

function formReflections(
  label: string,
  value: string,
): ReadonlyArray<readonly [string, string]> {
  const encoded = formEncode(value)
  const percent20 = encoded.replaceAll('+', '%20')
  return [
    [`raw ${label}`, value],
    [`form-encoded ${label}`, encoded],
    [`lowercase form-encoded ${label}`, lowercasePercentEscapes(encoded)],
    [`percent-20 form-encoded ${label}`, percent20],
    [`lowercase percent-20 form-encoded ${label}`, lowercasePercentEscapes(percent20)],
  ]
}

const EXCHANGE_REDACTION_REFLECTIONS = [
  ...formReflections('authorization code', FORM_CODE),
  ...formReflections('PKCE verifier', FORM_VERIFIER),
  ...formReflections('client id', FORM_CLIENT_ID),
  ...formReflections('client secret', FORM_CLIENT_SECRET),
  ['Basic authorization', FORM_AUTHORIZATION],
  ['bare Basic payload', FORM_BASIC_PAYLOAD],
] as const

const REFRESH_REDACTION_REFLECTIONS = [
  ...formReflections('refresh token', FORM_REFRESH_TOKEN),
  ...formReflections('client id', FORM_CLIENT_ID),
  ...formReflections('client secret', FORM_CLIENT_SECRET),
  ['Basic authorization', FORM_AUTHORIZATION],
  ['bare Basic payload', FORM_BASIC_PAYLOAD],
] as const

const REDACTION_CASES = (['exchange', 'refresh'] as const).flatMap((operation) =>
  (['response', 'transport'] as const).flatMap((boundary) =>
    (operation === 'exchange'
      ? EXCHANGE_REDACTION_REFLECTIONS
      : REFRESH_REDACTION_REFLECTIONS
    ).map(([label, reflected]) => [operation, boundary, label, reflected] as const),
  ),
)

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

  it.each(['exchange', 'refresh'] as const)(
    'form-encodes spaces and Unicode for client_secret_basic %s',
    async (operation) => {
      const fetchImpl = vi.fn(async (_url, init) => {
        const headers = init?.headers as Record<string, string>
        const body = init?.body as URLSearchParams
        expect(headers.authorization).toBe(FORM_AUTHORIZATION)
        expect(body.has('client_id')).toBe(false)
        expect(body.has('client_secret')).toBe(false)
        return Response.json({ access_token: 'access' })
      }) as typeof fetch

      if (operation === 'exchange') {
        await exchangeAuthorizationCode({
          tokenUrl: 'https://oauth.example/token',
          clientId: FORM_CLIENT_ID,
          clientSecret: FORM_CLIENT_SECRET,
          tokenClientAuthMethod: 'client_secret_basic',
          code: FORM_CODE,
          codeVerifier: FORM_VERIFIER,
          redirectUri: 'https://app.example/callback',
          fetchImpl,
        })
      } else {
        await refreshAccessToken({
          tokenUrl: 'https://oauth.example/token',
          clientId: FORM_CLIENT_ID,
          clientSecret: FORM_CLIENT_SECRET,
          tokenClientAuthMethod: 'client_secret_basic',
          refreshToken: FORM_REFRESH_TOKEN,
          fetchImpl,
        })
      }

      expect(fetchImpl).toHaveBeenCalledOnce()
    },
  )

  it.each(REDACTION_CASES)(
    'redacts %s %s %s reflections',
    async (operation, boundary, _representation, reflected) => {
      const fetchImpl = vi.fn(async () => {
        if (boundary === 'transport') throw new Error(`reflected=${reflected}`)
        return new Response(`reflected=${reflected}`, {
          status: 401,
          statusText: 'Unauthorized',
        })
      }) as typeof fetch
      let caught: unknown

      try {
        if (operation === 'exchange') {
          await exchangeAuthorizationCode({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            code: FORM_CODE,
            codeVerifier: FORM_VERIFIER,
            redirectUri: 'https://app.example/callback',
            fetchImpl,
          })
        } else {
          await refreshAccessToken({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            refreshToken: FORM_REFRESH_TOKEN,
            fetchImpl,
          })
        }
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain('[REDACTED]')
      expect((caught as Error).message).not.toContain(reflected)
    },
  )

  it.each(['exchange', 'refresh'] as const)(
    'redacts provider-controlled status text during %s',
    async (operation) => {
      const reflected = FORM_ENCODED_SECRET.toLowerCase()
      const fetchImpl = vi.fn(async () =>
        new Response('', {
          status: 401,
          statusText: reflected,
        })) as typeof fetch
      let caught: unknown

      try {
        if (operation === 'exchange') {
          await exchangeAuthorizationCode({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            code: FORM_CODE,
            codeVerifier: FORM_VERIFIER,
            redirectUri: 'https://app.example/callback',
            fetchImpl,
          })
        } else {
          await refreshAccessToken({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            refreshToken: FORM_REFRESH_TOKEN,
            fetchImpl,
          })
        }
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain('[REDACTED]')
      expect((caught as Error).message).not.toContain(reflected)
    },
  )

  it.each(['exchange', 'refresh'] as const)(
    'does not echo malformed successful JSON during %s',
    async (operation) => {
      const reflected = FORM_CLIENT_SECRET
      const fetchImpl = vi.fn(async () => new Response(reflected)) as typeof fetch
      let caught: unknown

      try {
        if (operation === 'exchange') {
          await exchangeAuthorizationCode({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            code: FORM_CODE,
            codeVerifier: FORM_VERIFIER,
            redirectUri: 'https://app.example/callback',
            fetchImpl,
          })
        } else {
          await refreshAccessToken({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: FORM_CLIENT_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            refreshToken: FORM_REFRESH_TOKEN,
            fetchImpl,
          })
        }
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toBe(
        operation === 'exchange'
          ? 'OAuth token exchange returned invalid JSON'
          : 'OAuth refresh returned invalid JSON',
      )
      expect((caught as Error).message).not.toContain(reflected)
    },
  )

  it.each(['exchange', 'refresh'] as const)(
    'redacts JSON-escaped secrets during %s',
    async (operation) => {
      const escaped = JSON.stringify(JSON_ESCAPED_SECRET).slice(1, -1)
      const fetchImpl = vi.fn(async () =>
        new Response(JSON.stringify({ error: JSON_ESCAPED_SECRET }), {
          status: 401,
          statusText: 'Unauthorized',
        })) as typeof fetch
      let caught: unknown

      try {
        if (operation === 'exchange') {
          await exchangeAuthorizationCode({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: JSON_ESCAPED_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            code: FORM_CODE,
            codeVerifier: FORM_VERIFIER,
            redirectUri: 'https://app.example/callback',
            fetchImpl,
          })
        } else {
          await refreshAccessToken({
            tokenUrl: 'https://oauth.example/token',
            clientId: FORM_CLIENT_ID,
            clientSecret: JSON_ESCAPED_SECRET,
            tokenClientAuthMethod: 'client_secret_basic',
            refreshToken: FORM_REFRESH_TOKEN,
            fetchImpl,
          })
        }
      } catch (error) {
        caught = error
      }

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain('[REDACTED]')
      expect((caught as Error).message).not.toContain(escaped)
      expect((caught as Error).message).not.toContain(JSON_ESCAPED_SECRET)
    },
  )

  it('redacts regex metacharacters and Unicode in normalized form reflections', () => {
    const secret = 'a.*[secret](✓) +% value'
    const encoded = formEncode(secret)
    const reflected = lowercasePercentEscapes(encoded.replaceAll('+', '%20'))
    expect(
      redactOAuthSensitiveText(`before:${reflected}:after`, [secret]),
    ).toBe('before:[REDACTED]:after')
  })

  it('redacts a reflected secret before slicing the provider response', async () => {
    const code = 'a.*[secret](✓) +% value'
    const reflected = lowercasePercentEscapes(
      formEncode(code).replaceAll('+', '%20'),
    )
    const prefix = 'x'.repeat(190)
    const fetchImpl = vi.fn(async () =>
      new Response(`${prefix}${reflected}`, {
        status: 401,
        statusText: 'Unauthorized',
      })) as typeof fetch

    let caught: unknown
    try {
      await exchangeAuthorizationCode({
        tokenUrl: 'https://oauth.example/token',
        clientId: FORM_CLIENT_ID,
        clientSecret: FORM_CLIENT_SECRET,
        tokenClientAuthMethod: 'client_secret_basic',
        code,
        codeVerifier: FORM_VERIFIER,
        redirectUri: 'https://app.example/callback',
        fetchImpl,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain(`${prefix}[REDACTED]`)
    expect((caught as Error).message).not.toContain(reflected.slice(0, 10))
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
