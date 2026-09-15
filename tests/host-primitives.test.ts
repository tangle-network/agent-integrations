import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { TangleSearchClient, buildTangleSearchRequest, parseTangleSearchResult } from '../src/tangle-search/index.js'
import { TwilioPhoneClient, authenticateTwilioForm, normalizePhoneNumber } from '../src/twilio/index.js'
import { requestJson } from '../src/http/response-json.js'

const accountSid = 'AC' + 'a'.repeat(32), verifyServiceSid = 'VA' + 'b'.repeat(32)
const authToken = 'fixture-auth-token-only', phone = '+13105551234', from = '+15555550123'
const verifyId = 'VE' + 'c'.repeat(32), messageId = 'SM' + 'd'.repeat(32)
const envelope = (overrides = {}) => ({ id: 'search-1', object: 'search.result', provider: 'you', query: 'linear guide',
  data: [{ title: 'Guide', url: 'https://parts.example/guide', snippet: '300 mm' }],
  usage: { billed_cost: 0.005, upstream_cost: null }, ...overrides })
const options = { accountSid, verifyServiceSid, authToken }
function sign(url: string, params: Record<string, string>) {
  return createHmac('sha1', authToken).update(url + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64')
}

test('Search uses one canonical Router request, explicit key and host pin', async () => {
  let calls = 0
  const client = new TangleSearchClient({ apiKey: 'router-key', provider: 'you', fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://router.tangle.tools/v1/search'); assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer router-key')
    assert.deepEqual(JSON.parse(String(init?.body)), { query: 'linear guide', max_results: 4, provider: 'you', include_domains: ['parts.example'] })
    return Response.json(envelope())
  } })
  const r = await client.search({ query: ' linear guide ', provider: 'another-provider', maxResults: 4, includeDomains: ['PARTS.example'] })
  assert.equal(calls, 1); assert.equal(r.provider, 'you'); assert.equal(r.usage.upstream_cost, null)
})
test('Arbitrary valid future provider IDs stay server-owned rather than an enum fork', () => {
  assert.equal(buildTangleSearchRequest({ query: 'part', provider: 'new-provider-2027' }).provider, 'new-provider-2027')
})
test('Unknown pagination and date filters fail instead of silently buying page one', () => {
  assert.throws(() => buildTangleSearchRequest({ query: 'part', offset: 2 } as any), { code: 'invalid_search_request' })
  assert.throws(() => buildTangleSearchRequest({ query: 'part', searchRecency: '2026-01-01' } as any), { code: 'invalid_search_request' })
})
test('No unrelated endpoint or embedded credentials are accepted', () => {
  for (const baseUrl of ['http://router.example', 'https://u:p@router.example', 'https://router.example/other', 'https://router.example/#token']) {
    assert.throws(() => new TangleSearchClient({ apiKey: 'secret', baseUrl }))
  }
})
test('Explicit custom HTTPS and loopback Router deployments retain the canonical route', async () => {
  for (const baseUrl of ['https://router.example/v1/', 'http://127.0.0.1:8787']) {
    const c = new TangleSearchClient({ baseUrl, apiKey: 'test', fetch: async url => {
      assert.equal(String(url), new URL(baseUrl).origin + '/v1/search'); return Response.json(envelope())
    } }); await c.search({ query: 'linear guide' })
  }
})
test('A pinned provider or query mismatch cannot become a successful search', () => {
  assert.throws(() => parseTangleSearchResult(envelope({ provider: 'brave' }), { query: 'linear guide', provider: 'you' }), { code: 'search_provider_mismatch' })
  assert.throws(() => parseTangleSearchResult(envelope(), { query: 'different query' }))
})
test('Malformed hits and active links are rejected; absent costs are not zero', () => {
  assert.throws(() => parseTangleSearchResult(envelope({ data: [{ url: 'javascript:alert(1)', title: 'Bad' }] }), { query: 'linear guide' }))
  const r = parseTangleSearchResult(envelope({ usage: { billed_cost: '0.001', upstream_cost: -1 } }), { query: 'linear guide' })
  assert.deepEqual(r.usage, { billed_cost: null, upstream_cost: null }); assert(!('thumbnail' in r.data[0]))
})
test('Router does not retry/fallback after a potentially billed failed request', async () => {
  let calls = 0; const c = new TangleSearchClient({ apiKey: 'test', fetch: async () => { calls++; return new Response('failed', { status: 503 }) } })
  await assert.rejects(() => c.search({ query: 'part' })); assert.equal(calls, 1)
})
test('Missing credentials and invalid result counts fail before dispatch', async () => {
  let calls = 0; const c = new TangleSearchClient({ apiKey: '', fetch: async () => { calls++; return Response.json(envelope()) } })
  await assert.rejects(() => c.search({ query: 'part' }), { code: 'search_not_configured' })
  for (const maxResults of [0, 26, 1.5]) assert.throws(() => buildTangleSearchRequest({ query: 'part', maxResults }))
  assert.equal(calls, 0)
})
test('No country is inferred when normalizing a phone number', () => {
  assert.equal(normalizePhoneNumber('+1 (310) 555-1234'), phone)
  for (const value of ['3105551234', '+0000000000', null]) assert.throws(() => normalizePhoneNumber(value))
})
test('Verify owns the OTP; the client correlates actual account, service and phone', async () => {
  let calls = 0; const c = new TwilioPhoneClient({ ...options, fetch: async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(String(init?.body)))
    assert.equal(new Headers(init?.headers).get('authorization'), 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'))
    calls++
    if (String(url).endsWith('/Verifications')) assert.deepEqual(form, { To: phone, Channel: 'sms' })
    else assert.deepEqual(form, { VerificationSid: verifyId, Code: '123456' })
    return Response.json({ sid: verifyId, account_sid: accountSid, service_sid: verifyServiceSid, to: phone, status: calls === 1 ? 'pending' : 'approved' })
  } })
  assert.deepEqual(await c.startVerification(phone), { id: verifyId }); assert(await c.checkVerification(verifyId, phone, '123456')); assert.equal(calls, 2)
})
test('An approved response for another account/service/phone/id cannot verify a user', async () => {
  for (const altered of [{ account_sid: 'AC' + '0'.repeat(32) }, { service_sid: 'VA' + '0'.repeat(32) }, { sid: 'VE' + '0'.repeat(32) }, { to: from }]) {
    const c = new TwilioPhoneClient({ ...options, fetch: async () => Response.json({ sid: verifyId, account_sid: accountSid, service_sid: verifyServiceSid, to: phone, status: 'approved', ...altered }) })
    await assert.rejects(() => c.checkVerification(verifyId, phone, '123456'), { code: 'verification_mismatch' })
  }
})
test('Invalid phone and code are rejected before provider calls', async () => {
  let n = 0; const c = new TwilioPhoneClient({ ...options, fetch: async () => { n++; return Response.json({}) } })
  await assert.rejects(() => c.startVerification('local number')); await assert.rejects(() => c.checkVerification(verifyId, phone, '<script>'))
  assert.equal(n, 0)
})
test('SMS supports an exact callback, preserves the body and does not assert delivery from queued', async () => {
  const text = 'Long reply '.repeat(200), callback = 'https://app.example/sms/status/message-1'
  const c = new TwilioPhoneClient({ ...options, fetch: async (url, init) => {
    assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`)
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init?.body))), { To: phone, From: from, Body: text, StatusCallback: callback })
    return Response.json({ sid: messageId, account_sid: accountSid, to: phone, from, status: 'queued' })
  } })
  const r = await c.sendMessage({ to: phone, from, body: text, statusCallback: callback }); assert.equal(r.deliveryConfirmed, false)
})
test('SMS receipt identity mismatch is uncertain, while explicit rejection is definitive', async () => {
  for (const altered of [{ to: from }, { sid: 'invalid' }, { status: 'failed' }]) {
    const c = new TwilioPhoneClient({ ...options, fetch: async () => Response.json({ sid: messageId, account_sid: accountSid, to: phone, from, status: 'queued', ...altered }) })
    await assert.rejects(() => c.sendMessage({ to: phone, from, body: 'hello' }), (e: any) => e.definitive === (altered.status === 'failed'))
  }
})
test('An unknown send result never gets automatically retried', async () => {
  let n = 0; const c = new TwilioPhoneClient({ ...options, fetch: async () => { n++; throw Error('lost connection') } })
  await assert.rejects(() => c.sendMessage({ to: phone, from, body: 'hello' })); assert.equal(n, 1)
})
test('Native signatures include every received field and exact URL query', () => {
  const url = 'https://app.example:443/sms?tenant=a%2Fb', params = { AccountSid: accountSid, Body: 'こんにちは', NewField: 'new & value' }
  const input = { url, rawBody: new URLSearchParams(params).toString(), signature: sign(url, params), authToken, accountSid }
  assert.equal(authenticateTwilioForm(input).NewField, 'new & value')
  for (const altered of [{ url: 'https://app.example/sms?tenant=a%2Fb' }, { rawBody: new URLSearchParams({ ...params, NewField: 'tampered' }).toString() }]) {
    assert.throws(() => authenticateTwilioForm({ ...input, ...altered }), { code: 'webhook_signature' })
  }
})
test('Webhook duplicate fields and another signed account fail closed', () => {
  const url = 'https://app.example/sms', params = { AccountSid: accountSid, Body: 'x' }, signature = sign(url, params)
  assert.throws(() => authenticateTwilioForm({ url, rawBody: new URLSearchParams(params).toString() + '&Body=y', signature, authToken, accountSid }), { code: 'invalid_webhook' })
  const other = { ...params, AccountSid: 'AC' + '0'.repeat(32) }
  assert.throws(() => authenticateTwilioForm({ url, rawBody: new URLSearchParams(other).toString(), signature: sign(url, other), authToken, accountSid }), { code: 'webhook_account' })
})
test('Provider error bodies and credentials do not escape into errors', async () => {
  await assert.rejects(() => requestJson('https://test.example', {}, { fetch: async () => new Response('secret leaked', { status: 403 }) }), (e: any) => !e.message.includes('secret'))
})
test('Response bytes are limited while reading, including multibyte content', async () => {
  let cancelled = false
  await assert.rejects(() => requestJson('https://test.example', {}, { maxResponseBytes: 20, fetch: async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('椅子'.repeat(20))) }, cancel() { cancelled = true } })) }), { code: 'response_limit' })
  assert(cancelled)
})
test('Cancellation after headers interrupts a stalled body even if fetch ignores its signal', async () => {
  const stop = new AbortController(); let entered!: () => void; const ready = new Promise<void>(r => { entered = r })
  const pending = requestJson('https://test.example', { signal: stop.signal }, { fetch: async () => { entered(); return new Response(new ReadableStream({ pull() {} })) } })
  await ready; await new Promise<void>(resolve => setImmediate(resolve)); stop.abort(); await assert.rejects(() => pending)
})
test('Already aborted requests never reach the transport', async () => {
  let n = 0; const stop = new AbortController(); stop.abort()
  await assert.rejects(() => requestJson('https://test.example', { signal: stop.signal }, { fetch: async () => { n++; return Response.json({}) } })); assert.equal(n, 0)
})


test('Messaging-only consumers do not need a Verify service or a new auth workflow', async () => {
  let calls = 0
  const client = new TwilioPhoneClient({ accountSid, authToken, fetch: async () => {
    calls++; return Response.json({ sid: messageId, account_sid: accountSid, to: phone, from, status: 'queued' })
  } })
  const receipt = await client.sendMessage({ to: phone, from, body: 'Requested update' })
  assert.equal(receipt.deliveryConfirmed, false)
  await assert.rejects(() => client.startVerification(phone), { code: 'phone_not_configured' })
  assert.equal(calls, 1)
})
