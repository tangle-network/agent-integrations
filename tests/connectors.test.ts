/**
 * Tests for the lower-level connector primitives:
 *   - signature verifiers (Stripe, Slack, generic HMAC)
 *   - OAuth helper (PKCE flow + state round-trip + replay refused)
 *
 * Type contracts (BaseConnector / Capability / CASStrategy / ResolvedDataSource)
 * are exercised at compile time and via the bridge tests in downstream consumers.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  parseStripeSignatureHeader,
  verifyStripeSignature,
  verifySlackSignature,
  verifyHmacSignature,
  firstHeader,
  startOAuthFlow,
  consumePendingFlow,
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
})

describe('firstHeader', () => {
  it('handles single-string values', () => {
    expect(firstHeader({ 'X-Foo': 'bar' }, 'X-Foo')).toBe('bar')
  })

  it('lowercases lookup', () => {
    expect(firstHeader({ 'x-foo': 'bar' }, 'X-Foo')).toBe('bar')
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

  it('round-trips a pending flow', () => {
    const out = startOAuthFlow({
      projectId: 'p1', kind: 'k', label: 'l',
      authorizationUrl: 'https://x/auth', scopes: ['x'],
      clientId: 'CID', redirectUri: 'https://a/cb',
    })
    const flow = consumePendingFlow(out.state)
    expect(flow.projectId).toBe('p1')
    expect(flow.codeVerifier.length).toBeGreaterThan(40)
  })

  it('refuses replay (consume twice = throw)', () => {
    const out = startOAuthFlow({
      projectId: 'p1', kind: 'k', label: 'l',
      authorizationUrl: 'https://x/auth', scopes: ['x'],
      clientId: 'CID', redirectUri: 'https://a/cb',
    })
    consumePendingFlow(out.state)
    expect(() => consumePendingFlow(out.state)).toThrow(/Unknown or expired/)
  })

  it('rejects unknown state (CSRF)', () => {
    expect(() => consumePendingFlow('garbage')).toThrow(/Unknown or expired/)
  })
})
