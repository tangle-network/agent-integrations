import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createTwilioWebhookProvider } from '../src/webhooks/twilio.js'
const accountSid = 'AC' + 'a'.repeat(32), messageSid = 'SM' + 'b'.repeat(32)
const url = 'https://app.example/sms/status?tenant=opaque', secret = 'fixture-secret'
function signed(params: Record<string,string>, at = url) {
  const signature = createHmac('sha1', secret).update(at + Object.keys(params).sort().map(k=>k+params[k]).join('')).digest('base64')
  return { rawBody: new URLSearchParams(params).toString(), headers: {'X-Twilio-Signature':signature}, secret }
}
test('Existing webhook-provider contract authenticates the exact bound route and new fields', () => {
  const provider = createTwilioWebhookProvider({url,accountSid,kind:'message'})
  const params = {AccountSid:accountSid,MessageSid:messageSid,Body:'Hello',FutureField:'new'}
  assert.deepEqual(provider.verifySignature(signed(params)),{valid:true})
  const other = signed(params, 'https://attacker.example/sms')
  assert.equal(provider.verifySignature(other).valid,false)
})
test('Message receipt parses one stable inbound identity without granting a workspace', async () => {
  const provider = createTwilioWebhookProvider({url,accountSid,kind:'message'}), input = signed({AccountSid:accountSid,MessageSid:messageSid,Body:'Hello'})
  assert(provider.verifySignature(input).valid)
  const events = await provider.parse({...input,now:1234})
  assert.equal(events.length,1);assert.equal(events[0].receivedAt,1234);assert.equal(events[0].eventType,'twilio.message.received')
  assert.equal((events[0].payload as any).Body,'Hello');assert(!('workspaceId' in events[0]))
  assert.equal(provider.successResponse?.body,'<Response/>')
})
test('Status identities do not discard a delivered callback after a queued one', async () => {
  const provider = createTwilioWebhookProvider({url,accountSid,kind:'status'})
  const ids=[]
  for(const MessageStatus of ['queued','delivered','delivered']) {
    const input=signed({AccountSid:accountSid,MessageSid:messageSid,MessageStatus})
    assert(provider.verifySignature(input).valid)
    ids.push((await provider.parse(input))[0].providerEventId)
  }
  assert.notEqual(ids[0],ids[1]);assert.equal(ids[1],ids[2])
})
test('Bad signatures, duplicate header arrays and foreign accounts fail before delivery', () => {
  const provider=createTwilioWebhookProvider({url,accountSid,kind:'message'})
  const input=signed({AccountSid:accountSid,MessageSid:messageSid})
  assert(!provider.verifySignature({...input,headers:{'x-twilio-signature':['one','two']}}).valid)
  assert(!provider.verifySignature({...input,rawBody:input.rawBody+'&AccountSid=other'}).valid)
  assert(!provider.verifySignature(signed({AccountSid:'AC'+'c'.repeat(32),MessageSid:messageSid})).valid)
})
test('Provider cannot change its trusted route after registration and malformed events are not guessed', async () => {
  const options={url,accountSid,kind:'status' as const},provider=createTwilioWebhookProvider(options)
  options.url='https://other.example/sms'
  const input=signed({AccountSid:accountSid,MessageSid:messageSid,MessageStatus:'delivered'})
  assert(provider.verifySignature(input).valid)
  assert.throws(()=>provider.parse(signed({AccountSid:accountSid,MessageSid:'invalid'})))
  assert.throws(()=>provider.parse(signed({AccountSid:accountSid,MessageSid:messageSid})))
})
