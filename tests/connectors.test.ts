/**
 * Tests for the lower-level connector primitives:
 *   - signature verifiers (Stripe, Slack, generic HMAC)
 *   - OAuth helper (PKCE flow + state round-trip + replay refused)
 *
 * Type contracts (ConnectorAdapter / Capability / CASStrategy / ResolvedDataSource)
 * are exercised at compile time and via the bridge tests in downstream consumers.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
  verifySlackSignature,
  verifyHmacSignature,
  verifyTwilioSignature,
  firstHeader,
  startOAuthFlow,
  consumePendingFlow,
  InMemoryOAuthFlowStore,
  validateConnectorManifest,
  assertValidConnectorManifest,
  _resetPendingFlowsForTests,
} from '../src/connectors/index'

describe('parseStripeSignatureHeader', () => {
  it('parses single-v1 header', () => {
    const r = parseStripeSignatureHeader('t=123,v1=abc')
    expect(r).toEqual({ t: 123, sigs: ['abc'] })
  })

  it('parses multi-v1 header (rotation)', () => {
    const r = parseStripeSignatureHeader('t=123,v1=abc,v1=def')
    expect(r).toEqual({ t: 123, sigs: ['abc', 'def'] })
  })

  it('returns null on missing fields', () => {
    expect(parseStripeSignatureHeader('v1=abc')).toBeNull()
    expect(parseStripeSignatureHeader('t=123')).toBeNull()
    expect(parseStripeSignatureHeader('garbage')).toBeNull()
  })

  it('ignores unknown segments', () => {
    const r = parseStripeSignatureHeader('t=123,v0=ignored,v1=keep')
    expect(r).toEqual({ t: 123, sigs: ['keep'] })
  })
})

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test'
  const body = '{"id":"evt_1","type":"customer.created"}'

  it('accepts a correctly-signed payload', () => {
    const t = 1_700_000_000
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, { now: t })).toBe(true)
  })

  it('rejects a stale timestamp (outside default 5-min window)', () => {
    const t = 1_700_000_000
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, { now: t + 600 })).toBe(false)
  })

  it('rejects a wrong signature', () => {
    const t = 1_700_000_000
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef`, secret, { now: t })).toBe(false)
  })

  it('accepts when ANY rotated v1 matches', () => {
    const t = 1_700_000_000
    const right = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    expect(verifyStripeSignature(body, `t=${t},v1=stale1,v1=${right}`, secret, { now: t })).toBe(true)
  })

  it('honors custom toleranceSeconds', () => {
    const t = 1_700_000_000
    const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, { now: t + 1200, toleranceSeconds: 1500 })).toBe(true)
  })
})

describe('verifySlackSignature', () => {
  const secret = 'slack_signing_secret'
  const body = '{"type":"event_callback"}'

  it('accepts a correctly-signed payload', () => {
    const ts = 1_700_000_000
    const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
    expect(verifySlackSignature(body, sig, String(ts), secret, { now: ts })).toBe(true)
  })

  it('rejects a missing v0= prefix', () => {
    const ts = 1_700_000_000
    const raw = createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
    expect(verifySlackSignature(body, raw, String(ts), secret, { now: ts })).toBe(false)
  })

  it('rejects a stale timestamp', () => {
    const ts = 1_700_000_000
    const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
    expect(verifySlackSignature(body, sig, String(ts), secret, { now: ts + 600 })).toBe(false)
  })

  it('rejects an invalid timestamp', () => {
    expect(verifySlackSignature(body, 'v0=anything', 'not-a-number', secret, { now: 0 })).toBe(false)
  })
})

describe('verifyHmacSignature (generic)', () => {
  it('accepts a sha256 signature with prefix', () => {
    const body = 'hello'
    const secret = 's'
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyHmacSignature(body, sig, secret, { signaturePrefix: 'sha256=' })).toBe(true)
  })

  it('accepts sha512', () => {
    const body = 'payload'
    const secret = 'shh'
    const sig = createHmac('sha512', secret).update(body).digest('hex')
    expect(verifyHmacSignature(body, sig, secret, { algorithm: 'sha512' })).toBe(true)
  })

  it('rejects mismatched signature', () => {
    expect(verifyHmacSignature('hello', 'deadbeef', 's')).toBe(false)
  })

  it('rejects missing required prefix when configured', () => {
    const body = 'hello'
    const secret = 's'
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyHmacSignature(body, sig, secret, { signaturePrefix: 'sha256=' })).toBe(false)
  })
})

describe('firstHeader', () => {
  it('handles single-string values', () => {
    expect(firstHeader({ 'X-Foo': 'bar' }, 'X-Foo')).toBe('bar')
  })

  it('lowercases lookup', () => {
    expect(firstHeader({ 'x-foo': 'bar' }, 'X-Foo')).toBe('bar')
  })

  it('handles mixed-case header keys', () => {
    expect(firstHeader({ 'X-Slack-Signature': 'sig' }, 'x-slack-signature')).toBe('sig')
  })

  it('takes first of array', () => {
    expect(firstHeader({ 'x-foo': ['a', 'b'] }, 'x-foo')).toBe('a')
  })

  it('returns undefined when missing', () => {
    expect(firstHeader({}, 'x-foo')).toBeUndefined()
  })
})

describe('startOAuthFlow / consumePendingFlow', () => {
  beforeEach(() => _resetPendingFlowsForTests())

  it('produces a PKCE-shaped authorization URL', () => {
    const out = startOAuthFlow({
      projectId: 'p1',
      kind: 'google-calendar',
      label: 'Front desk',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      clientId: 'CID',
      redirectUri: 'https://app.example.com/cb',
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    })
    const url = new URL(out.authorizationUrl)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('CID')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('state')).toBe(out.state)
  })

  it('round-trips a pending flow', async () => {
    const out = startOAuthFlow({
      projectId: 'p1', kind: 'k', label: 'l',
      authorizationUrl: 'https://x/auth', scopes: ['x'],
      clientId: 'CID', redirectUri: 'https://a/cb',
    })
    const flow = await consumePendingFlow(out.state)
    expect(flow.projectId).toBe('p1')
    expect(flow.codeVerifier.length).toBeGreaterThan(40)
  })

  it('round-trips through an injected flow store', async () => {
    const store = new InMemoryOAuthFlowStore()
    const out = startOAuthFlow({
      projectId: 'p1', kind: 'k', label: 'l',
      authorizationUrl: 'https://x/auth', scopes: ['x'],
      clientId: 'CID', redirectUri: 'https://a/cb',
      store,
    })
    const flow = await consumePendingFlow(out.state, store)
    expect(flow.kind).toBe('k')
  })

  it('refuses replay (consume twice = throw)', async () => {
    const out = startOAuthFlow({
      projectId: 'p1', kind: 'k', label: 'l',
      authorizationUrl: 'https://x/auth', scopes: ['x'],
      clientId: 'CID', redirectUri: 'https://a/cb',
    })
    await consumePendingFlow(out.state)
    await expect(consumePendingFlow(out.state)).rejects.toThrow(/Unknown or expired/)
  })

  it('rejects unknown state (CSRF)', async () => {
    await expect(consumePendingFlow('garbage')).rejects.toThrow(/Unknown or expired/)
  })
})

describe('validateConnectorManifest', () => {
  it('accepts an authoritative mutation with CAS', () => {
    const result = validateConnectorManifest({
      kind: 'calendar',
      displayName: 'Calendar',
      description: 'Calendar connector',
      auth: { kind: 'oauth2', authorizationUrl: 'https://x/auth', tokenUrl: 'https://x/token', scopes: ['calendar.write'], clientIdEnv: 'CID', clientSecretEnv: 'SECRET' },
      defaultConsistencyModel: 'authoritative',
      category: 'calendar',
      capabilities: [{
        name: 'events.create',
        class: 'mutation',
        description: 'Create event',
        parameters: {},
        cas: 'etag-if-match',
        externalEffect: true,
      }],
    })
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('rejects duplicate names and authoritative fire-and-forget mutation', () => {
    const result = validateConnectorManifest({
      kind: 'calendar',
      displayName: 'Calendar',
      description: 'Calendar connector',
      auth: { kind: 'none' },
      defaultConsistencyModel: 'authoritative',
      category: 'calendar',
      capabilities: [
        { name: 'events.create', class: 'read', description: 'Read', parameters: {} },
        { name: 'events.create', class: 'mutation', description: 'Create', parameters: {}, cas: 'none', externalEffect: true },
      ],
      rateLimit: { requests: 0, windowMs: -1 },
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'capabilities[1].name',
      'capabilities[1].cas',
      'rateLimit.requests',
      'rateLimit.windowMs',
    ]))
  })

  it('assertValidConnectorManifest throws with actionable paths', () => {
    expect(() => assertValidConnectorManifest({
      kind: '',
      displayName: '',
      description: 'Bad',
      auth: { kind: 'none' },
      defaultConsistencyModel: 'advisory',
      category: 'other',
      capabilities: [],
    })).toThrow(/kind/)
  })
})

describe('verifyTwilioSignature', () => {
  const authToken = 'twilio_auth_token_test'
  const fullUrl = 'https://api.example.com/twilio/sms'

  function compute(params: Record<string, string>, token = authToken, url = fullUrl): string {
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url)
    return createHmac('sha1', token).update(data).digest('base64')
  }

  it('accepts a correctly-signed POST', () => {
    const params = { From: '+15551234567', Body: 'hi', MessageSid: 'SM1' }
    const sig = compute(params)
    expect(verifyTwilioSignature({ authToken, signatureHeader: sig, fullUrl, params })).toBe(true)
  })

  it('is order-insensitive on params (canonical sort applied)', () => {
    const sig = compute({ a: '1', b: '2', c: '3' })
    expect(verifyTwilioSignature({
      authToken, signatureHeader: sig, fullUrl, params: { c: '3', a: '1', b: '2' },
    })).toBe(true)
  })

  it('rejects a wrong signature', () => {
    expect(verifyTwilioSignature({
      authToken, signatureHeader: 'AAAAA=', fullUrl, params: { x: 'y' },
    })).toBe(false)
  })

  it('rejects an array signature header', () => {
    expect(verifyTwilioSignature({
      authToken, signatureHeader: ['a', 'b'], fullUrl, params: {},
    })).toBe(false)
  })

  it('rejects a missing fullUrl', () => {
    expect(verifyTwilioSignature({
      authToken, signatureHeader: 'x', fullUrl: null, params: {},
    })).toBe(false)
  })

  it('rejects when authToken missing and dev-skip not set', () => {
    expect(verifyTwilioSignature({
      authToken: null, signatureHeader: 'x', fullUrl, params: {},
    })).toBe(false)
  })

  it('returns true when authToken missing AND skipWhenAuthTokenMissing is set', () => {
    expect(verifyTwilioSignature({
      authToken: null, signatureHeader: 'x', fullUrl, params: {},
    }, { skipWhenAuthTokenMissing: true })).toBe(true)
  })

  it('signs the raw body when bodyAsRaw=true (JSON Conversations webhooks)', () => {
    const rawBody = '{"foo":"bar"}'
    const data = fullUrl + rawBody
    const sig = createHmac('sha1', authToken).update(data).digest('base64')
    expect(verifyTwilioSignature(
      { authToken, signatureHeader: sig, fullUrl, params: undefined },
      { bodyAsRaw: true, rawBody },
    )).toBe(true)
  })
})
