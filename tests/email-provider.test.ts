import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { emailWebhookProvider, type InboundEmailPayload } from '../src/webhooks/index'

const secret = 'whk_email_secret_abc'

function sign(rawBody: string, ts: number): { signature: string; timestamp: string } {
  return {
    signature: createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex'),
    timestamp: String(ts),
  }
}

function headers(rawBody: string, ts: number): Record<string, string> {
  const { signature, timestamp } = sign(rawBody, ts)
  return {
    'x-tangle-email-signature': signature,
    'x-tangle-email-timestamp': timestamp,
  }
}

const message: InboundEmailPayload = {
  messageId: '<abc@mail.example.com>',
  from: 'partner@almaraz.example',
  to: 'whk_tok123@inbound.tangle.sh',
  subject: 'New claim',
  text: 'please review',
}

describe('emailWebhookProvider.verifySignature', () => {
  it('rejects a tampered body', () => {
    const rawBody = JSON.stringify(message)
    const h = headers(rawBody, Math.floor(Date.now() / 1000))
    const res = emailWebhookProvider.verifySignature({ rawBody: rawBody + 'x', headers: h, secret })
    expect(res).toEqual({ valid: false, reason: 'invalid_signature' })
  })

  it('rejects a stale (replayed) timestamp beyond tolerance', () => {
    const rawBody = JSON.stringify(message)
    const stale = Math.floor(Date.now() / 1000) - 10_000
    const res = emailWebhookProvider.verifySignature({ rawBody, headers: headers(rawBody, stale), secret })
    expect(res).toEqual({ valid: false, reason: 'invalid_signature' })
  })

  it('rejects a missing signature header', () => {
    const rawBody = JSON.stringify(message)
    const res = emailWebhookProvider.verifySignature({
      rawBody,
      headers: { 'x-tangle-email-timestamp': String(Math.floor(Date.now() / 1000)) },
      secret,
    })
    expect(res).toEqual({ valid: false, reason: 'missing_email_signature' })
  })

  it('rejects a missing timestamp header', () => {
    const rawBody = JSON.stringify(message)
    const res = emailWebhookProvider.verifySignature({
      rawBody,
      headers: { 'x-tangle-email-signature': 'deadbeef' },
      secret,
    })
    expect(res).toEqual({ valid: false, reason: 'missing_email_timestamp' })
  })

  it('accepts with a current timestamp end-to-end', () => {
    const rawBody = JSON.stringify(message)
    const res = emailWebhookProvider.verifySignature({
      rawBody,
      headers: headers(rawBody, Math.floor(Date.now() / 1000)),
      secret,
    })
    expect(res).toEqual({ valid: true })
  })
})

describe('emailWebhookProvider.parse', () => {
  it('normalizes a message into one email.received envelope keyed on messageId', async () => {
    const [env] = await emailWebhookProvider.parse({ rawBody: JSON.stringify(message), headers: {} })
    expect(env.provider).toBe('email')
    expect(env.eventType).toBe('email.received')
    expect(env.providerEventId).toBe('<abc@mail.example.com>')
    const payload = env.payload as InboundEmailPayload
    // `to` is the owner-resolution key the platform matches to the connection.
    expect(payload.to).toBe('whk_tok123@inbound.tangle.sh')
    expect(payload.from).toBe('partner@almaraz.example')
  })

  it('acks (no-op) a malformed body missing from/to', async () => {
    expect(await emailWebhookProvider.parse({ rawBody: JSON.stringify({ subject: 'x' }), headers: {} })).toEqual([])
    expect(await emailWebhookProvider.parse({ rawBody: 'not json', headers: {} })).toEqual([])
  })
})

describe('emailWebhookProvider.eventCatalog', () => {
  it('declares a single closed email.received event', () => {
    expect(emailWebhookProvider.eventCatalog).toEqual({
      namespace: 'email.',
      closed: true,
      events: [{ id: 'email.received' }],
    })
  })
})
