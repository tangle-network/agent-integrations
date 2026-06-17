import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hellosignWebhookProvider, telegramWebhookProvider } from '../src/webhooks/index'

describe('telegramWebhookProvider', () => {
  const secret = 'tg_secret_token_abc'

  it('accepts a matching X-Telegram-Bot-Api-Secret-Token', () => {
    const res = telegramWebhookProvider.verifySignature({
      rawBody: '{}',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      secret,
    })
    expect(res.valid).toBe(true)
  })

  it('rejects a mismatched token', () => {
    const res = telegramWebhookProvider.verifySignature({
      rawBody: '{}',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      secret,
    })
    expect(res.valid).toBe(false)
  })

  it('rejects a missing token header', () => {
    const res = telegramWebhookProvider.verifySignature({
      rawBody: '{}',
      headers: {},
      secret,
    })
    expect(res).toEqual({ valid: false, reason: 'missing_telegram_secret_token' })
  })

  it('parses an update into a typed envelope keyed on update_id', async () => {
    const body = JSON.stringify({
      update_id: 42,
      message: { message_id: 1, text: 'hi', chat: { id: 7 } },
    })
    const [env] = await telegramWebhookProvider.parse({
      rawBody: body,
      headers: {},
    })
    expect(env.provider).toBe('telegram')
    expect(env.eventType).toBe('telegram.message')
    expect(env.providerEventId).toBe('42')
  })

  it('classifies a callback_query update', async () => {
    const body = JSON.stringify({
      update_id: 43,
      callback_query: { id: 'cq1', data: 'x' },
    })
    const [env] = await telegramWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.eventType).toBe('telegram.callback_query')
  })

  it('returns [] for a non-JSON body', async () => {
    expect(await telegramWebhookProvider.parse({ rawBody: 'not json', headers: {} })).toEqual([])
  })
})

describe('hellosignWebhookProvider', () => {
  const apiKey = 'hs_api_key_xyz'

  /** Build a Dropbox Sign event body with a correctly computed event_hash. */
  function signedBody(eventType: string, eventTime: string, key = apiKey) {
    const event_hash = createHmac('sha256', key)
      .update(`${eventTime}${eventType}`)
      .digest('hex')
    return JSON.stringify({
      event: { event_time: eventTime, event_type: eventType, event_hash },
    })
  }

  it('accepts a body whose event_hash matches HMAC(secret, event_time+event_type)', () => {
    const res = hellosignWebhookProvider.verifySignature({
      rawBody: signedBody('signature_request_signed', '1700000000'),
      headers: {},
      secret: apiKey,
    })
    expect(res.valid).toBe(true)
  })

  it('rejects when signed with a different key', () => {
    const res = hellosignWebhookProvider.verifySignature({
      rawBody: signedBody('signature_request_signed', '1700000000', 'other_key'),
      headers: {},
      secret: apiKey,
    })
    expect(res).toEqual({ valid: false, reason: 'invalid_signature' })
  })

  it('rejects a body missing event fields', () => {
    const res = hellosignWebhookProvider.verifySignature({
      rawBody: JSON.stringify({ event: { event_type: 'x' } }),
      headers: {},
      secret: apiKey,
    })
    expect(res).toEqual({ valid: false, reason: 'missing_event_fields' })
  })

  it('verifies a form-urlencoded json= body (older apps)', () => {
    const inner = signedBody('signature_request_sent', '1700000001')
    const res = hellosignWebhookProvider.verifySignature({
      rawBody: `json=${encodeURIComponent(inner)}`,
      headers: {},
      secret: apiKey,
    })
    expect(res.valid).toBe(true)
  })

  it('parses the event into an envelope keyed on event_hash', async () => {
    const eventType = 'signature_request_all_signed'
    const body = signedBody(eventType, '1700000002')
    const [env] = await hellosignWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.provider).toBe('hellosign')
    expect(env.eventType).toBe(`hellosign.${eventType}`)
    expect(typeof env.providerEventId).toBe('string')
  })
})
