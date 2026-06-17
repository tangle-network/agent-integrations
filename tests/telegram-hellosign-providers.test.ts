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

  it('classifies a message_reaction update (extended Bot API types)', async () => {
    const body = JSON.stringify({
      update_id: 44,
      message_reaction: { chat: { id: 7 }, message_id: 1 },
    })
    const [env] = await telegramWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.eventType).toBe('telegram.message_reaction')
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

  it('decodes + as space in a form-urlencoded json= body', async () => {
    const eventType = 'signature_request_sent'
    const eventTime = '1700000020'
    const event_hash = createHmac('sha256', apiKey)
      .update(`${eventTime}${eventType}`)
      .digest('hex')
    const inner = JSON.stringify({
      event: { event_time: eventTime, event_type: eventType, event_hash },
      signature_request: { title: 'Master Service Agreement' },
    })
    // URLSearchParams.toString() encodes spaces as `+`, exactly as a real
    // application/x-www-form-urlencoded post does.
    const raw = new URLSearchParams({ json: inner }).toString()
    expect(raw).toContain('+')
    const res = hellosignWebhookProvider.verifySignature({ rawBody: raw, headers: {}, secret: apiKey })
    expect(res.valid).toBe(true)
    const [env] = await hellosignWebhookProvider.parse({ rawBody: raw, headers: {} })
    const payload = env.payload as { signature_request?: { title?: string } }
    // `+` must round-trip to a real space, not a literal plus.
    expect(payload.signature_request?.title).toBe('Master Service Agreement')
  })

  /** A multipart/form-data delivery carrying the event JSON in the `json`
   *  part — Dropbox Sign's default callback encoding. */
  function multipartBody(inner: string, boundary = '----testboundary') {
    return [
      `--${boundary}`,
      'Content-Disposition: form-data; name="json"',
      '',
      inner,
      `--${boundary}--`,
      '',
    ].join('\r\n')
  }

  it('verifies and parses a multipart name="json" body', async () => {
    const eventType = 'signature_request_sent'
    const raw = multipartBody(signedBody(eventType, '1700000010'))
    const res = hellosignWebhookProvider.verifySignature({
      rawBody: raw,
      headers: {},
      secret: apiKey,
    })
    expect(res.valid).toBe(true)
    const [env] = await hellosignWebhookProvider.parse({ rawBody: raw, headers: {} })
    expect(env.eventType).toBe(`hellosign.${eventType}`)
    expect(typeof env.providerEventId).toBe('string')
  })

  it('returns [] for a multipart body with no closing boundary', async () => {
    // name="json" part present but never terminated by a `\r\n--` boundary —
    // extraction yields nothing rather than parsing a truncated fragment.
    const raw = '------b\r\nContent-Disposition: form-data; name="json"\r\n\r\n{"event":{"event_type":"x"}'
    expect(await hellosignWebhookProvider.parse({ rawBody: raw, headers: {} })).toEqual([])
  })

  it('parses the event into an envelope keyed on a body digest', async () => {
    const eventType = 'signature_request_all_signed'
    const body = signedBody(eventType, '1700000002')
    const [env] = await hellosignWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.provider).toBe('hellosign')
    expect(env.eventType).toBe(`hellosign.${eventType}`)
    // sha256 hex of the parsed body.
    expect(env.providerEventId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keys distinct same-second, same-type events to distinct providerEventIds', async () => {
    // event_hash is identical for these (same event_time + event_type), which
    // is exactly the collision the body-digest key avoids.
    const t = '1700000005'
    const type = 'signature_request_signed'
    const event_hash = createHmac('sha256', apiKey).update(`${t}${type}`).digest('hex')
    const mk = (id: string) =>
      JSON.stringify({
        event: { event_time: t, event_type: type, event_hash },
        signature_request: { signature_request_id: id },
      })
    const [a] = await hellosignWebhookProvider.parse({ rawBody: mk('req_A'), headers: {} })
    const [b] = await hellosignWebhookProvider.parse({ rawBody: mk('req_B'), headers: {} })
    expect(a.providerEventId).not.toBe(b.providerEventId)
    // A byte-identical redelivery of one event dedups to the same id.
    const [a2] = await hellosignWebhookProvider.parse({ rawBody: mk('req_A'), headers: {} })
    expect(a2.providerEventId).toBe(a.providerEventId)
  })

  it('prefers the canonical event.event_id for providerEventId when present', async () => {
    const eventType = 'signature_request_signed'
    const eventTime = '1700000030'
    const event_hash = createHmac('sha256', apiKey)
      .update(`${eventTime}${eventType}`)
      .digest('hex')
    const body = JSON.stringify({
      event: { event_time: eventTime, event_type: eventType, event_hash, event_id: 'evt_canonical_1' },
    })
    const [env] = await hellosignWebhookProvider.parse({ rawBody: body, headers: {} })
    expect(env.providerEventId).toBe('evt_canonical_1')
  })

  it('exposes the literal Dropbox Sign ACK body', () => {
    expect(hellosignWebhookProvider.successResponse?.body).toBe('Hello API Event Received')
  })
})
