/** Host-side protocol primitives. Enrollment, sessions, consent and workspaces belong to the app. */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { ProviderProtocolError, record, requestJson, type JsonRequestOptions } from '../http/response-json.js'
export { ProviderProtocolError } from '../http/response-json.js'

export function normalizePhoneNumber(value: unknown): string {
  if (typeof value !== 'string') throw new ProviderProtocolError('An international phone number is required', 'invalid_phone', 400, true)
  const phone = value.trim().replace(/[ ()-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ProviderProtocolError('Include the phone country code', 'invalid_phone', 400, true)
  return phone
}
function requireValue(condition: unknown, message: string, code = 'provider_protocol', status = 502): asserts condition {
  if (!condition) throw new ProviderProtocolError(message, code, status)
}
const sid = (value: unknown, prefix: string): value is string => typeof value === 'string' && new RegExp(`^${prefix}[a-f0-9]{32}$`, 'i').test(value)
export interface TwilioPhoneOptions extends JsonRequestOptions {
  accountSid: string
  authToken: string
  /** Required only for verification; messaging-only consumers do not need a Verify service. */
  verifyServiceSid?: string
}
export interface TwilioSendInput {
  to: string
  from: string
  body: string
  /** Host-chosen URL, never taken from the provider response. */
  statusCallback?: string
}
export interface TwilioMessageReceipt {
  receiptId: string
  status: string
  /** False for queued/accepted/sent. No assertion about human reading. */
  deliveryConfirmed: boolean
}

/** Fixed Twilio endpoints, one attempt. A send has no automatic retry or claimed native idempotency. */
export class TwilioPhoneClient {
  private readonly options: TwilioPhoneOptions
  constructor(options: TwilioPhoneOptions) {
    requireValue(sid(options.accountSid, 'AC') && (options.verifyServiceSid === undefined || sid(options.verifyServiceSid, 'VA')) &&
      typeof options.authToken === 'string' && options.authToken.length >= 16,
      'Configure valid Twilio account credentials', 'phone_not_configured', 503)
    this.options = { ...options }
  }
  private async request(host: 'verify' | 'api', path: string, input?: Record<string, string>, signal?: AbortSignal) {
    const value = await requestJson(`https://${host}.twilio.com${path}`, {
      method: input ? 'POST' : 'GET', signal,
      headers: { Authorization: 'Basic ' + Buffer.from(`${this.options.accountSid}:${this.options.authToken}`).toString('base64'),
        ...(input ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: input ? new URLSearchParams(input).toString() : undefined,
    }, { maxResponseBytes: 128_000, ...this.options })
    requireValue(record(value), 'Twilio returned no structured response')
    return value
  }
  private service(): string {
    requireValue(this.options.verifyServiceSid, 'Configure a Verify service for phone verification', 'phone_not_configured', 503)
    return this.options.verifyServiceSid
  }
  async startVerification(to: string, signal?: AbortSignal): Promise<{ id: string }> {
    this.service()
    const phone = normalizePhoneNumber(to)
    const r = await this.request('verify', `/v2/Services/${this.options.verifyServiceSid}/Verifications`, { To: phone, Channel: 'sms' }, signal)
    requireValue(sid(r.sid, 'VE') && r.account_sid === this.options.accountSid && r.service_sid === this.options.verifyServiceSid &&
      r.to === phone && r.status === 'pending', 'Verification did not match the requested account, service and phone', 'verification_mismatch')
    return { id: r.sid }
  }
  async checkVerification(id: string, to: string, code: string, signal?: AbortSignal): Promise<boolean> {
    this.service()
    requireValue(sid(id, 'VE') && typeof code === 'string' && /^\d{4,10}$/.test(code), 'Invalid verification identity or code', 'invalid_code', 400)
    const phone = normalizePhoneNumber(to)
    const r = await this.request('verify', `/v2/Services/${this.options.verifyServiceSid}/VerificationCheck`, { VerificationSid: id, Code: code }, signal)
    requireValue(r.sid === id && r.account_sid === this.options.accountSid && r.service_sid === this.options.verifyServiceSid &&
      r.to === phone, 'Verification did not match the requested account, service and phone', 'verification_mismatch')
    return r.status === 'approved'
  }
  async sendMessage(input: TwilioSendInput, signal?: AbortSignal): Promise<TwilioMessageReceipt> {
    const to = normalizePhoneNumber(input.to), from = normalizePhoneNumber(input.from)
    requireValue(typeof input.body === 'string' && input.body.length > 0, 'A message body is required', 'invalid_message', 400)
    if (input.statusCallback) {
      const u = new URL(input.statusCallback)
      requireValue(u.protocol === 'https:' && !u.username && !u.password && !u.hash,
        'Status callback must be a host-chosen HTTPS URL', 'invalid_callback', 400)
    }
    const r = await this.request('api', `/2010-04-01/Accounts/${this.options.accountSid}/Messages.json`,
      { To: to, From: from, Body: input.body, ...(input.statusCallback ? { StatusCallback: input.statusCallback } : {}) }, signal)
    requireValue(sid(r.sid, 'SM') && r.account_sid === this.options.accountSid && r.to === to && r.from === from,
      'Message receipt did not match the requested account and participants', 'receipt_mismatch')
    if (['failed', 'undelivered', 'canceled'].includes(String(r.status))) {
      throw new ProviderProtocolError('Twilio rejected message delivery', 'sms_rejected', 502, true)
    }
    requireValue(typeof r.status === 'string' && ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'].includes(r.status),
      'Twilio returned an unrecognized message state', 'receipt_mismatch')
    return { receiptId: r.sid, status: r.status, deliveryConfirmed: r.status === 'delivered' || r.status === 'read' }
  }
  async inspect(number: string, signal?: AbortSignal) {
    const phone = normalizePhoneNumber(number)
    const service = this.options.verifyServiceSid ? await this.request('verify', `/v2/Services/${this.options.verifyServiceSid}`, undefined, signal) : null
    const numbers = await this.request('api', `/2010-04-01/Accounts/${this.options.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`, undefined, signal)
    return { verifyConnected: service !== null && service.sid === this.options.verifyServiceSid && service.account_sid === this.options.accountSid,
      senderOwned: Array.isArray(numbers.incoming_phone_numbers) && numbers.incoming_phone_numbers.some(n => record(n) &&
        n.account_sid === this.options.accountSid && n.phone_number === phone && record(n.capabilities) && n.capabilities.sms === true),
      liveDeliveryProven: false as const }
  }
}

export interface TwilioFormInput {
  /** Exact external URL (including its query). Never derive this from untrusted forwarded headers. */
  url: string
  rawBody: string | Uint8Array
  signature: unknown
  authToken: string
  accountSid: string
}
/** Form webhooks only. Does not support JSON bodySHA256 or establish freshness/replay protection. */
export function authenticateTwilioForm(input: TwilioFormInput): Record<string, string> {
  const u = new URL(input.url)
  requireValue(u.protocol === 'https:' && !u.username && !u.password && !u.hash, 'An exact HTTPS webhook URL is required', 'invalid_callback', 400)
  requireValue(typeof input.authToken === 'string' && input.authToken.length > 0 && sid(input.accountSid, 'AC'), 'Invalid verification configuration', 'phone_not_configured', 503)
  const body = typeof input.rawBody === 'string' ? input.rawBody : new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
  requireValue(new TextEncoder().encode(body).length <= 64_000, 'Webhook body is too large', 'invalid_webhook', 413)
  const params: Record<string, string> = Object.create(null)
  for (const [key, value] of new URLSearchParams(body)) {
    requireValue(!Object.hasOwn(params, key), 'Repeated webhook fields are ambiguous', 'invalid_webhook', 400)
    params[key] = value
  }
  requireValue(typeof input.signature === 'string' && /^[A-Za-z0-9+/]{27}=$/.test(input.signature), 'Invalid Twilio signature', 'webhook_signature', 401)
  // Use the exact caller-supplied URL, not URL.href (which normalizes ports/escaping).
  const material = input.url + Object.keys(params).sort().map(k => k + params[k]).join('')
  const expected = createHmac('sha1', input.authToken).update(material).digest()
  const actual = Buffer.from(input.signature, 'base64')
  requireValue(actual.length === expected.length && timingSafeEqual(actual, expected), 'Invalid Twilio signature', 'webhook_signature', 401)
  requireValue(params.AccountSid === input.accountSid, 'Unexpected Twilio account', 'webhook_account', 403)
  return params
}
