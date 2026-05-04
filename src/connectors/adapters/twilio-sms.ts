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
    throw new Error(`twilio-sms: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    if (inv.capabilityName !== 'send_sms') {
      throw new Error(`twilio-sms: unknown mutation capability ${inv.capabilityName}`)
    }
    const auth = parseAuth(inv.source.credentials)
    const { to, body, from } = inv.args as { to: string; body: string; from?: string }
    const fromNumber = from ?? readMetaString(inv.source.metadata, 'fromNumber')
    const formBody = new URLSearchParams({ To: to, From: fromNumber, Body: body })
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
      // Twilio surfaces 409 when an idempotency-key conflict is detected
      // (same key, different request body).
      throw new ResourceContention('Twilio idempotency-key conflict — different args under same key')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`twilio-sms send_sms ${res.status}: ${text.slice(0, 200)}`)
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
