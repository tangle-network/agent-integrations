import { describe, expect, it } from 'vitest'
import {
  classifyGoogleError,
  classifyGoogleReason,
  CredentialsExpired,
  googleApiError,
  googleErrorReason,
  googleTestFailureReason,
  ProviderConfigError,
  ProviderRateLimited,
} from '../src/connectors/index'

/** A Google JSON API error envelope. */
function envelope(code: number, status: string, reason: string, message = 'msg') {
  return {
    error: { code, status, message, errors: [{ reason, message, domain: 'global' }] },
  }
}

describe('classifyGoogleError', () => {
  it('bare 401 → CredentialsExpired (reconnect)', () => {
    const err = classifyGoogleError(401, undefined, 'gmail list_messages', 'src_1')
    expect(err).toBeInstanceOf(CredentialsExpired)
    expect(err).toMatchObject({ name: 'CredentialsExpired', status: 401, dataSourceId: 'src_1' })
  })

  it('bare 403 (no reason) → ProviderConfigError, NOT a credential failure', () => {
    const err = classifyGoogleError(403, 'forbidden', 'gmail send', 'src_1')
    expect(err).toBeInstanceOf(ProviderConfigError)
    expect(err).not.toBeInstanceOf(CredentialsExpired)
    expect(err).toMatchObject({ name: 'ProviderConfigError', status: 403 })
  })

  it('403 accessNotConfigured → ProviderConfigError carrying the reason + body', () => {
    const body = envelope(403, 'PERMISSION_DENIED', 'accessNotConfigured')
    const err = classifyGoogleError(403, body, 'gmail list_messages', 'src_1') as ProviderConfigError
    expect(err.name).toBe('ProviderConfigError')
    expect(err.reason).toBe('accessNotConfigured')
    expect(err.body).toBe(body)
    expect(err.message).toContain('accessNotConfigured')
  })

  it('403 insufficientPermissions → ProviderConfigError', () => {
    const err = classifyGoogleError(403, envelope(403, 'PERMISSION_DENIED', 'insufficientPermissions'), 'x', 's')
    expect(err).toBeInstanceOf(ProviderConfigError)
  })

  it('403 with only a top-level PERMISSION_DENIED status → ProviderConfigError', () => {
    const body = { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }
    expect(classifyGoogleError(403, body, 'x', 's')).toBeInstanceOf(ProviderConfigError)
  })

  it.each(['dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])(
    '403 %s → ProviderRateLimited (quota, not auth) with a "rate limit" message',
    (reason) => {
      const err = classifyGoogleError(403, envelope(403, 'RESOURCE_EXHAUSTED', reason), 'gmail list_messages', 's') as ProviderRateLimited
      expect(err).toBeInstanceOf(ProviderRateLimited)
      expect(err.reason).toBe(reason)
      expect(err.message.toLowerCase()).toContain('rate limit')
    },
  )

  it.each(['authError', 'invalidCredentials', 'invalid_grant'])(
    '403 with a true-credential reason %s → CredentialsExpired (reconnect)',
    (reason) => {
      expect(classifyGoogleError(403, envelope(403, 'PERMISSION_DENIED', reason), 'x', 's')).toBeInstanceOf(CredentialsExpired)
    },
  )

  it('429 → ProviderRateLimited', () => {
    expect(classifyGoogleError(429, undefined, 'x', 's')).toBeInstanceOf(ProviderRateLimited)
  })

  // Precedence on a 401 with a conflicting reason: quota is matched first, then
  // the 401 status, so the routing is order-sensitive — pin it so a reorder of
  // the guard chain fails a test rather than silently flipping the class.
  it('401 + quota reason → ProviderRateLimited (quota beats the 401 status)', () => {
    expect(classifyGoogleError(401, envelope(401, 'RESOURCE_EXHAUSTED', 'dailyLimitExceeded'), 'x', 's')).toBeInstanceOf(ProviderRateLimited)
  })

  it('401 + config reason → CredentialsExpired (the 401 status beats a config reason)', () => {
    expect(classifyGoogleError(401, envelope(401, 'PERMISSION_DENIED', 'insufficientPermissions'), 'x', 's')).toBeInstanceOf(CredentialsExpired)
  })

  it('non-auth status (500) → generic Error, not a typed provider error', () => {
    const err = classifyGoogleError(500, 'boom', 'gmail send', 's')
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(CredentialsExpired)
    expect(err).not.toBeInstanceOf(ProviderConfigError)
    expect(err).not.toBeInstanceOf(ProviderRateLimited)
    expect(err.message).toContain('500')
  })
})

describe('googleErrorReason', () => {
  it('prefers errors[0].reason', () => {
    expect(googleErrorReason(envelope(403, 'PERMISSION_DENIED', 'accessNotConfigured'))).toBe('accessNotConfigured')
  })
  it('falls back to top-level error.status', () => {
    expect(googleErrorReason({ error: { code: 403, status: 'PERMISSION_DENIED' } })).toBe('PERMISSION_DENIED')
  })
  it('returns undefined for non-envelope bodies', () => {
    expect(googleErrorReason('forbidden')).toBeUndefined()
    expect(googleErrorReason(undefined)).toBeUndefined()
    expect(googleErrorReason({ nope: true })).toBeUndefined()
  })
})

describe('classifyGoogleReason', () => {
  it.each([
    ['accessNotConfigured', 'config'],
    ['insufficientPermissions', 'config'],
    ['PERMISSION_DENIED', 'config'],
    ['dailyLimitExceeded', 'quota'],
    ['rateLimitExceeded', 'quota'],
    ['authError', 'auth'],
    ['invalid_grant', 'auth'],
    ['unknownReason', undefined],
  ])('maps %s → %s', (reason, expected) => {
    expect(classifyGoogleReason(reason)).toBe(expected)
  })
})

describe('googleApiError (reads the Response body before classifying)', () => {
  it('a JSON 403 accessNotConfigured body → ProviderConfigError + reason', async () => {
    const res = new Response(JSON.stringify(envelope(403, 'PERMISSION_DENIED', 'accessNotConfigured')), { status: 403 })
    const err = (await googleApiError(res, 'gmail list_messages', 's')) as ProviderConfigError
    expect(err).toBeInstanceOf(ProviderConfigError)
    expect(err.reason).toBe('accessNotConfigured')
  })
  it('a JSON 403 dailyLimitExceeded body → ProviderRateLimited', async () => {
    const res = new Response(JSON.stringify(envelope(403, 'RESOURCE_EXHAUSTED', 'dailyLimitExceeded')), { status: 403 })
    expect(await googleApiError(res, 'x', 's')).toBeInstanceOf(ProviderRateLimited)
  })
  it('a non-JSON 403 body → bare 403 ProviderConfigError', async () => {
    const res = new Response('forbidden', { status: 403 })
    expect(await googleApiError(res, 'x', 's')).toBeInstanceOf(ProviderConfigError)
  })
})

describe('googleTestFailureReason', () => {
  it('401 → reconnect required', () => {
    expect(googleTestFailureReason(401, undefined, 'Gmail')).toMatch(/reconnect required/i)
  })
  it('config 403 → NOT reconnect; points at API/scopes', () => {
    const reason = googleTestFailureReason(403, envelope(403, 'PERMISSION_DENIED', 'accessNotConfigured'), 'Gmail')
    expect(reason).not.toMatch(/reconnect/i)
    expect(reason).toMatch(/API|scope/i)
  })
  it('quota 403 → retry later, NOT reconnect', () => {
    const reason = googleTestFailureReason(403, envelope(403, 'RESOURCE_EXHAUSTED', 'dailyLimitExceeded'), 'Gmail')
    expect(reason).not.toMatch(/reconnect/i)
    expect(reason).toMatch(/retry later/i)
  })
})
