/**
 * Twilio SMS connector — outbound texts + recent-message lookup. The
 * agent's "send the caller a confirmation link" surface.
 *
 * Auth: HTTP Basic (Account SID + Auth Token). Twilio's API key auth
 * also supports SID/Secret pairs; we accept either by treating the
 * stored apiKey envelope as `accountSid:authToken` (or
 * `accountSid:keySid:secret`) — the connector parses it at call time.
 *
 *   send_sms(to, body)
 *     Mutation. CAS = native-idempotency. Twilio added the
 *     `Idempotency-Key` HTTP header to POST /Messages in 2024 — same
 *     key + same args within 24h returns the original Message resource
 *     instead of sending a second SMS. MutationGuard's record short-
 *     circuits before us; Twilio's own dedup is defense-in-depth.
 *
 *   lookup_number(phoneNumber)
 *     Read. Hits /v1/PhoneNumbers/{e164} on Lookup API. Confirms the
 *     number is real, returns carrier info if the caller has Lookup
 *     enabled on their account.
 *
 *   find_recent_messages(toOrFrom?, limit?)
 *     Read. Returns the most recent Messages on the account, optionally
 *     filtered by To/From. Useful for "did the confirmation actually
 *     send?" introspection inside an agent run.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'

const API = 'https://api.twilio.com/2010-04-01'
const LOOKUP_API = 'https://lookups.twilio.com/v1'

export const twilioSmsConnector: ConnectorAdapter = {
  manifest: {
    kind: 'twilio-sms',
    displayName: 'Twilio SMS',
    description:
      "Send outbound SMS, look up phone numbers, and audit recent messages. Twilio's native Idempotency-Key prevents duplicate sends on retry.",
    auth: {
      kind: 'api-key',
      hint: 'Paste your Twilio credentials as "AccountSid:AuthToken" (e.g. "AC123…:abc…"). API-key style "AccountSid:KeySid:Secret" is also accepted.',
    },
    category: 'comms',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'send_sms',
        class: 'mutation',
        description: 'Send an SMS from the configured Twilio number to the supplied destination.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'E.164 destination, e.g. +14155551212' },
            body: { type: 'string', description: 'Message body (≤1600 chars after Twilio segments).' },
            from: { type: 'string', description: 'Optional E.164 sender; falls back to metadata.fromNumber.' },
          },
          required: ['to', 'body'],
        },
      },
      {
        name: 'lookup_number',
        class: 'read',
        description: 'Validate a phone number and (if your account has Lookup) retrieve carrier metadata.',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: { type: 'string', description: 'E.164 number to look up.' },
            includeCarrier: { type: 'boolean', default: false },
          },
          required: ['phoneNumber'],
        },
      },
      {
        name: 'find_recent_messages',
        class: 'read',
        description: 'Return up to `limit` recent Messages on the account, optionally filtered by To or From.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Optional E.164 filter on the To address.' },
            from: { type: 'string', description: 'Optional E.164 filter on the From address.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
      {
        name: 'send_mms',
        class: 'mutation',
        description: 'Send an MMS message with one or more media URLs attached.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'E.164 destination.' },
            body: { type: 'string', description: 'Optional MMS body (may be empty when only sending media).' },
            from: { type: 'string', description: 'Optional E.164 sender; falls back to metadata.fromNumber.' },
            mediaUrl: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'One or more media URLs Twilio should attach to the MMS.',
            },
          },
          required: ['to', 'mediaUrl'],
        },
      },
      {
        name: 'send_whatsapp',
        class: 'mutation',
        description: 'Send a WhatsApp message via Twilio (To/From use the whatsapp: prefix).',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'E.164 destination (the connector prepends `whatsapp:` if missing).' },
            body: { type: 'string', description: 'WhatsApp message body.' },
            from: { type: 'string', description: 'Optional sender; falls back to metadata.whatsappFromNumber or metadata.fromNumber.' },
          },
          required: ['to', 'body'],
        },
      },
      {
        name: 'redact_message',
        class: 'mutation',
        description: 'Redact the body of an already-delivered SMS by SID. Sets Body="" on the Message resource.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            messageSid: { type: 'string', description: 'SID of the Message to redact (SM…).' },
          },
          required: ['messageSid'],
        },
      },
      {
        name: 'list_numbers',
        class: 'read',
        description: 'List the IncomingPhoneNumbers owned by the account.',
        parameters: {
          type: 'object',
          properties: {
            phoneNumber: { type: 'string', description: 'Optional exact-match filter on the E.164 number.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const auth = parseAuth(inv.source.credentials)
    if (inv.capabilityName === 'lookup_number') {
      const { phoneNumber, includeCarrier } = inv.args as { phoneNumber: string; includeCarrier?: boolean }
      const url = `${LOOKUP_API}/PhoneNumbers/${encodeURIComponent(phoneNumber)}${includeCarrier ? '?Type=carrier' : ''}`
      const res = await fetch(url, {
        headers: { authorization: basicAuth(auth) },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 401) throw new CredentialsExpired('Twilio rejected credentials (401)', inv.source.id)
      if (res.status === 404) {
        return { data: { valid: false }, fetchedAt: Date.now() }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`twilio-sms lookup_number ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as { phone_number?: string; carrier?: unknown; country_code?: string }
      return {
        data: {
          valid: true,
          phoneNumber: json.phone_number,
          countryCode: json.country_code,
          carrier: json.carrier,
        },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'find_recent_messages') {
      const { to, from, limit } = inv.args as { to?: string; from?: string; limit?: number }
      const params = new URLSearchParams()
      params.set('PageSize', String(Math.min(Math.max(1, limit ?? 20), 100)))
      if (to) params.set('To', to)
      if (from) params.set('From', from)
      const url = `${API}/Accounts/${encodeURIComponent(auth.accountSid)}/Messages.json?${params.toString()}`
      const res = await fetch(url, {
        headers: { authorization: basicAuth(auth) },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 401) throw new CredentialsExpired('Twilio rejected credentials (401)', inv.source.id)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`twilio-sms find_recent_messages ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        messages?: Array<{ sid: string; to: string; from: string; body: string; status: string; date_sent?: string }>
      }
      return {
        data: { messages: json.messages ?? [] },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'list_numbers') {
      const { phoneNumber, limit } = inv.args as { phoneNumber?: string; limit?: number }
      const params = new URLSearchParams()
      params.set('PageSize', String(Math.min(Math.max(1, limit ?? 50), 100)))
      if (phoneNumber) params.set('PhoneNumber', phoneNumber)
      const url = `${API}/Accounts/${encodeURIComponent(auth.accountSid)}/IncomingPhoneNumbers.json?${params.toString()}`
      const res = await fetch(url, {
        headers: { authorization: basicAuth(auth) },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 401) throw new CredentialsExpired('Twilio rejected credentials (401)', inv.source.id)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`twilio-sms list_numbers ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        incoming_phone_numbers?: Array<{ sid: string; phone_number: string; friendly_name?: string; capabilities?: unknown }>
      }
      return {
        data: { numbers: json.incoming_phone_numbers ?? [] },
        fetchedAt: Date.now(),
      }
    }
    throw new Error(`twilio-sms: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const auth = parseAuth(inv.source.credentials)
    if (inv.capabilityName === 'send_sms') {
      const { to, body, from } = inv.args as { to: string; body: string; from?: string }
      const fromNumber = from ?? readMetaString(inv.source.metadata, 'fromNumber')
      const formBody = new URLSearchParams({ To: to, From: fromNumber, Body: body })
      return await postMessages(inv, auth, formBody, 'send_sms')
    }
    if (inv.capabilityName === 'send_mms') {
      const { to, body, from, mediaUrl } = inv.args as {
        to: string
        body?: string
        from?: string
        mediaUrl: string | string[]
      }
      const fromNumber = from ?? readMetaString(inv.source.metadata, 'fromNumber')
      const formBody = new URLSearchParams()
      formBody.set('To', to)
      formBody.set('From', fromNumber)
      if (typeof body === 'string') formBody.set('Body', body)
      const media = Array.isArray(mediaUrl) ? mediaUrl : [mediaUrl]
      for (const m of media) formBody.append('MediaUrl', m)
      return await postMessages(inv, auth, formBody, 'send_mms')
    }
    if (inv.capabilityName === 'send_whatsapp') {
      const { to, body, from } = inv.args as { to: string; body: string; from?: string }
      const ensureWhatsapp = (n: string): string => (n.startsWith('whatsapp:') ? n : `whatsapp:${n}`)
      const fromRaw = from ?? readMetaStringOptional(inv.source.metadata, 'whatsappFromNumber') ?? readMetaString(inv.source.metadata, 'fromNumber')
      const formBody = new URLSearchParams({
        To: ensureWhatsapp(to),
        From: ensureWhatsapp(fromRaw),
        Body: body,
      })
      return await postMessages(inv, auth, formBody, 'send_whatsapp')
    }
    if (inv.capabilityName === 'redact_message') {
      const { messageSid } = inv.args as { messageSid: string }
      const url = `${API}/Accounts/${encodeURIComponent(auth.accountSid)}/Messages/${encodeURIComponent(messageSid)}.json`
      const formBody = new URLSearchParams({ Body: '' })
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: basicAuth(auth),
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': inv.idempotencyKey,
        },
        body: formBody,
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 401) throw new CredentialsExpired('Twilio rejected credentials (401)', inv.source.id)
      if (res.status === 409) {
        throw new ResourceContention('Twilio idempotency-key conflict — different args under same key')
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`twilio-sms redact_message ${res.status}: ${text.slice(0, 200)}`)
      }
      const updated = (await res.json()) as { sid: string; status: string; body: string }
      return {
        status: 'committed',
        data: { messageSid: updated.sid, deliveryStatus: updated.status, body: updated.body },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    throw new Error(`twilio-sms: unknown mutation capability ${inv.capabilityName}`)
  },

  async test(source) {
    try {
      const auth = parseAuth(source.credentials)
      // GET /Accounts/{sid}.json is the cheapest auth probe.
      const res = await fetch(`${API}/Accounts/${encodeURIComponent(auth.accountSid)}.json`, {
        headers: { authorization: basicAuth(auth) },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) return { ok: false, reason: 'Twilio rejected credentials (401) — reconnect required' }
      if (!res.ok) return { ok: false, reason: `Twilio returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

interface TwilioAuth {
  accountSid: string
  /** Either the Account auth token, or an API key SID. */
  username: string
  /** Either the same auth token, or the API key secret. */
  password: string
}

function parseAuth(creds: { kind: string; apiKey?: string }): TwilioAuth {
  if (creds.kind !== 'api-key' || typeof creds.apiKey !== 'string') {
    throw new Error('twilio-sms: expected api-key credentials')
  }
  const parts = creds.apiKey.split(':')
  if (parts.length === 2) {
    // accountSid:authToken — username is the SID, password is the token.
    const [accountSid, authToken] = parts
    if (!accountSid.startsWith('AC')) {
      throw new Error('twilio-sms: AccountSid must start with "AC"')
    }
    return { accountSid, username: accountSid, password: authToken }
  }
  if (parts.length === 3) {
    // accountSid:apiKeySid:apiKeySecret — basic-auth username is the
    // API key SID, not the AccountSid.
    const [accountSid, keySid, secret] = parts
    if (!accountSid.startsWith('AC')) {
      throw new Error('twilio-sms: AccountSid must start with "AC"')
    }
    return { accountSid, username: keySid, password: secret }
  }
  throw new Error('twilio-sms: apiKey must be "AccountSid:AuthToken" or "AccountSid:KeySid:Secret"')
}

function basicAuth(auth: TwilioAuth): string {
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`twilio-sms DataSource.metadata.${key} is missing`)
  }
  return v
}

function readMetaStringOptional(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

async function postMessages(
  inv: ConnectorInvocation,
  auth: TwilioAuth,
  formBody: URLSearchParams,
  label: string,
): Promise<CapabilityMutationResult> {
  const url = `${API}/Accounts/${encodeURIComponent(auth.accountSid)}/Messages.json`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: basicAuth(auth),
      'content-type': 'application/x-www-form-urlencoded',
      'idempotency-key': inv.idempotencyKey,
    },
    body: formBody,
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) throw new CredentialsExpired('Twilio rejected credentials (401)', inv.source.id)
  if (res.status === 409) {
    throw new ResourceContention('Twilio idempotency-key conflict — different args under same key')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`twilio-sms ${label} ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as {
    sid: string
    status: string
    to: string
    from: string
    date_sent?: string
  }
  return {
    status: 'committed',
    data: { messageSid: created.sid, deliveryStatus: created.status, to: created.to, from: created.from },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}
