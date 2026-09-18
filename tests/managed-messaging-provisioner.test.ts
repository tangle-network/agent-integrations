import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { InkboxProvisioner, MessagingProvisionError, parseInkboxIdentity } from '../src/managed-messaging/index.js'

const identityId = '550e8400-e29b-41d4-a716-446655440000'
const numberId = '550e8400-e29b-41d4-a716-446655440001'
const identity = { id: identityId, agent_handle: 'tng-fixture', organization_id: 'org', status: 'active',
  imessage_enabled: false, phone_number: null, imessage_number: null }
const number = { id: numberId, number: '+15551112222', sms_status: 'pending', status: 'active' }
function fixture(...responses: Array<unknown | Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next : Response.json(next)
  }
  return { client: new InkboxProvisioner({ adminKey: 'admin-fixture', fetchImpl }), calls }
}

describe('host-only Inkbox provisioner', () => {
  it('requires configuration before issuing HTTP', () => {
    assert.throws(() => new InkboxProvisioner({ adminKey: '' }), /unavailable/)
    assert.throws(() => new InkboxProvisioner({ adminKey: 'key\nattack' }), /unavailable/)
    assert.throws(() => new InkboxProvisioner({ adminKey: 'key', timeoutMs: Infinity }), /invalid_input/)
  })
  it('does not serialize administrative credentials with the client', () => {
    assert(!JSON.stringify(fixture().client).includes('admin-fixture'))
  })
  it('checks administrative scope without leaking the self response', async () => {
    const f = fixture({ scoped_identity_id: null, status: 'active' })
    await f.client.verifyAdminKey()
    assert.equal(f.calls[0].url, 'https://inkbox.ai/api/v1/api-keys/self')
    await assert.rejects(fixture({ scoped_identity_id: identityId, status: 'active' }).client.verifyAdminKey(), /invalid_receipt/)
  })
  it('creates a private identity with no inherited vault or organization mail domain', async () => {
    const f = fixture(identity)
    const receipt = await f.client.createIdentity('tng-fixture')
    assert.equal(receipt.id, identityId)
    assert.equal(f.calls[0].url, 'https://inkbox.ai/api/v1/identities')
    assert.equal(f.calls[0].init.redirect, 'error')
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
      agent_handle: 'tng-fixture', imessage_enabled: false, contact_sharing_enabled: false, mailbox: { sending_domain: null },
    })
  })
  it('pins the iMessage claim to one durable operation key', async () => {
    const f = fixture({ ...identity, imessage_enabled: true, imessage_number: number })
    const receipt = await f.client.claimIMessage('tng-fixture', 'order1:claim')
    assert.equal(receipt.imessage?.number, number.number)
    assert.equal(f.calls[0].init.method, 'PATCH')
    assert.equal(new Headers(f.calls[0].init.headers).get('Idempotency-Key'), 'order1:claim')
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { imessage_enabled: true, claim_imessage_number: true })
  })
  it('provisions SMS with voice explicitly rejected and preserves pending readiness', async () => {
    const f = fixture(number)
    assert.equal((await f.client.provisionSms('tng-fixture', 'order1:sms', 'CA')).smsStatus, 'pending')
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), {
      agent_handle: 'tng-fixture', type: 'local', incoming_call_action: 'auto_reject', state: 'CA',
    })
    assert.equal(new Headers(f.calls[0].init.headers).get('Idempotency-Key'), 'order1:sms')
  })
  it('refuses an SMS purchase without a stable operation key', async () => {
    const f = fixture(number)
    await assert.rejects(f.client.provisionSms('tng-fixture', ''), { code: 'invalid_input' })
    assert.equal(f.calls.length, 0)
  })
  for (const value of ['../foreign', 'ab', 'UPPERCASE', 'bad--handle', 'x'.repeat(64)]) {
    it(`rejects an invalid handle before HTTP: ${value}`, async () => {
      const f = fixture(identity)
      await assert.rejects(f.client.createIdentity(value), /invalid_input/)
      assert.equal(f.calls.length, 0)
    })
  }
  it('rejects a receipt for another handle', async () => {
    await assert.rejects(fixture({ ...identity, agent_handle: 'foreign' }).client.getIdentity('tng-fixture'), /invalid_receipt/)
  })
  for (const status of [408, 429, 500, 503]) {
    it(`reports a read failing with HTTP ${status} as unavailable, never as a refusal`, async () => {
      await assert.rejects(fixture(new Response('busy', { status })).client.getIdentity('tng-fixture'), { code: 'unavailable', status })
    })
  }
  it('keeps a missing identity distinct from an authentication failure', async () => {
    assert.equal(await fixture(new Response(null, { status: 404 })).client.getIdentity('tng-fixture'), null)
    await assert.rejects(fixture(new Response('no', { status: 401 })).client.getIdentity('tng-fixture'), { code: 'provider_rejected', status: 401 })
  })
  it('returns a once-shown scoped credential immediately for durable encryption', async () => {
    const f = fixture({ api_key: 'private-fixture', record: { id: 'key1', scoped_identity_id: identityId } })
    assert.deepEqual(await f.client.mintIdentityKey(identityId, 'order1'), { key: 'private-fixture', keyId: 'key1' })
    assert.equal(f.calls.length, 1) // No fallible read between receipt and host persistence.
  })
  it('verifies a persisted scoped key without using the admin credential', async () => {
    const f = fixture({ id: 'key1', scoped_identity_id: identityId, status: 'active' })
    await f.client.verifyIdentityKey('private-fixture', identityId, 'key1')
    assert.equal(new Headers(f.calls[0].init.headers).get('X-API-Key'), 'private-fixture')
    await assert.rejects(fixture({ id: 'key1', scoped_identity_id: null, status: 'active' }).client.verifyIdentityKey('k', identityId, 'key1'), /invalid_receipt/)
  })
  it('does not accept an admin key disguised as a customer credential receipt', async () => {
    const f = fixture({ api_key: 'never-echo-this', record: { id: 'key1', scoped_identity_id: null } })
    await assert.rejects(f.client.mintIdentityKey(identityId, 'order1'), error => {
      assert(error instanceof MessagingProvisionError)
      assert(!String(error).includes('never-echo-this'))
      return true
    })
  })
  for (const status of [408, 500, 502, 503]) {
    it(`retains an uncertain mutation at HTTP ${status} without retrying`, async () => {
      const f = fixture(new Response('sensitive-provider-detail', { status, headers: { 'Retry-After': '3600' } }))
      await assert.rejects(f.client.provisionSms('tng-fixture', 'order1:sms'), { code: 'outcome_unknown', status, retryAfterSeconds: 3600 })
      assert.equal(f.calls.length, 1)
    })
  }
  it('never retries transport loss or returns a secret-bearing error', async () => {
    const f = fixture(new Error('admin-fixture secret-provider-diagnostic'))
    await assert.rejects(f.client.provisionSms('tng-fixture', 'order1:sms'), error => {
      assert(error instanceof MessagingProvisionError)
      assert.equal(error.code, 'outcome_unknown')
      assert(!String(error).includes('admin-fixture'))
      return true
    })
    assert.equal(f.calls.length, 1)
  })
  it('rejects malformed and oversized receipts without exposing their bodies', async () => {
    await assert.rejects(fixture(new Response('not json')).client.createIdentity('tng-fixture'), /invalid_receipt/)
    await assert.rejects(fixture(new Response('x'.repeat(1_048_577))).client.createIdentity('tng-fixture'), /invalid_receipt/)
  })
  it('never includes unrelated identity fields in public receipts', () => {
    const value = parseInkboxIdentity({ ...identity, signing_key: 'secret', tunnel: { credentials: 'private' } })
    assert(!JSON.stringify(value).includes('secret'))
    assert(!JSON.stringify(value).includes('credentials'))
  })
  it('accepts idempotent deletion and refuses failed carrier release', async () => {
    await fixture(new Response(null, { status: 204 })).client.deleteIdentity('tng-fixture')
    await fixture(new Response(null, { status: 404 })).client.deleteIdentity('tng-fixture')
    await assert.rejects(fixture(new Response(null, { status: 502 })).client.deleteIdentity('tng-fixture'), { code: 'outcome_unknown' })
  })
})
