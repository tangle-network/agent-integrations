/**
 * Microsoft Graph Calendar connector — the Outlook half of the
 * voice-agent's "book me a slot" surface.
 *
 * Mirrors the Google Calendar pattern almost line-for-line, with two
 * upstream-specific quirks worth calling out:
 *
 *   1. Graph exposes `@odata.etag` on every event resource AND honors
 *      `If-Match` on `events.patch` / `events.delete`. So unlike Calendar
 *      (insert can't be preconditioned against a non-existent resource),
 *      we DO get real etag CAS for updates after the booking. We still
 *      use the freebusy pre-flight for the create path, because the
 *      "two callers grab the same slot" race happens before any event
 *      exists.
 *
 *   2. `getSchedule` is the Graph equivalent of `freeBusy.query`. Same
 *      shape: send `[start, end]` plus the calendar's email/UPN, get
 *      back a `scheduleItems` list of busy windows.
 *
 * Why the same flow ports cleanly: the conflict mode is identical
 * ("did someone else grab this slot between read and write?"). The
 * mechanism — pre-flight read + idempotent insert — composes regardless
 * of whether upstream gives us a request-id dedup feature. Graph does
 * not have a `requestId` analogue on `events.create`, so we rely
 * exclusively on MutationGuard's idempotency-key short-circuit ABOVE
 * the connector. That layer prevents duplicate inserts on retry.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPES = [
  'https://graph.microsoft.com/Calendars.ReadWrite',
  // offline_access is required to receive a refresh_token from the v2.0
  // endpoint; without it Graph hands back access tokens only and the
  // connection silently dies after ~1 hour.
  'offline_access',
]
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface MicrosoftCalendarOptions {
  clientId: string
  clientSecret: string
}

export function microsoftCalendar(opts: MicrosoftCalendarOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    kind: 'microsoft-calendar',
    displayName: 'Microsoft Calendar (Outlook 365)',
    description:
      "Let your agent check availability and book against an Outlook / Microsoft 365 calendar. Conflict-resolved via Graph's getSchedule pre-flight; etag-guarded on event updates.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      clientIdEnv: 'MS_OAUTH_CLIENT_ID',
      clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      // Microsoft v2.0 doesn't need extra params to issue a refresh_token
      // as long as `offline_access` is in scopes (above).
    },
    category: 'calendar',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'list_availability',
        class: 'read',
        description:
          'Look up busy windows on the connected Outlook calendar between timeMin and timeMax (RFC3339 timestamps).',
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'ISO8601 lower bound (inclusive)' },
            timeMax: { type: 'string', description: 'ISO8601 upper bound (exclusive)' },
          },
          required: ['timeMin', 'timeMax'],
        },
      },
      {
        name: 'book_slot',
        class: 'mutation',
        description:
          'Reserve a time window on the connected Outlook calendar. Returns conflict + alternatives if the slot is no longer free.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'ISO8601 start time' },
            end: { type: 'string', description: 'ISO8601 end time' },
            summary: { type: 'string', description: 'Event title (subject)' },
            description: { type: 'string', description: 'Optional event body' },
            attendees: {
              type: 'array',
              items: { type: 'string', description: 'attendee email' },
            },
          },
          required: ['start', 'end', 'summary'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    if (inv.capabilityName !== 'list_availability') {
      throw new Error(`microsoft-calendar: unknown read capability ${inv.capabilityName}`)
    }
    const userPrincipal = readMetaString(inv.source.metadata, 'userPrincipal')
    const { timeMin, timeMax } = inv.args as { timeMin: string; timeMax: string }
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    const busy = await getScheduleBusy({ accessToken, userPrincipal, timeMin, timeMax })
    return {
      data: { busy },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    if (inv.capabilityName !== 'book_slot') {
      throw new Error(`microsoft-calendar: unknown mutation capability ${inv.capabilityName}`)
    }
    const userPrincipal = readMetaString(inv.source.metadata, 'userPrincipal')
    const { start, end, summary, description, attendees } = inv.args as {
      start: string
      end: string
      summary: string
      description?: string
      attendees?: string[]
    }
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)

    // Pre-flight: getSchedule for [start, end] on this user.
    const busy = await getScheduleBusy({ accessToken, userPrincipal, timeMin: start, timeMax: end })
    if (busy.length > 0) {
      const startMs = Date.parse(start)
      const endMs = Date.parse(end)
      const durMs = endMs - startMs
      const alternatives = await findNextFreeSlots({
        accessToken,
        userPrincipal,
        searchFromMs: endMs,
        durationMs: durMs,
        wanted: 3,
      })
      throw new ResourceContention(
        `requested slot ${start}–${end} is no longer free`,
        alternatives,
        { busy },
      )
    }

    const event = {
      subject: summary,
      body: description ? { contentType: 'text', content: description } : undefined,
      start: { dateTime: start, timeZone: 'UTC' },
      end: { dateTime: end, timeZone: 'UTC' },
      attendees: attendees?.map(email => ({
        emailAddress: { address: email },
        type: 'required',
      })),
    }
    const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401 || res.status === 403) {
      throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, inv.source.id)
    }
    if (res.status === 412 || res.status === 409) {
      // 412 = If-Match precondition failed (not used on insert but Graph
      // can return it under specific concurrent-update races). 409 covers
      // duplicate resourceId on rare retries.
      throw new ResourceContention(
        `Microsoft Graph reported conflict on book_slot (${res.status})`,
        [],
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`microsoft-calendar book_slot ${res.status}: ${text.slice(0, 200)}`)
    }
    const created = (await res.json()) as { id: string; '@odata.etag'?: string; webLink?: string }
    return {
      status: 'committed',
      data: { eventId: created.id, webLink: created.webLink },
      etagAfter: created['@odata.etag'],
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async exchangeOAuth(input) {
    if (!clientId || !clientSecret) {
      throw new Error('Microsoft OAuth client not configured (MS_OAUTH_CLIENT_ID / _SECRET)')
    }
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: TOKEN_URL,
      clientId,
      clientSecret,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
    })
    return {
      credentials: {
        kind: 'oauth2',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      },
      scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
      // Operator picks the shared mailbox / room calendar post-connect.
      // Default to the authenticated user's own primary calendar via 'me'.
      metadata: { userPrincipal: 'me' },
    }
  },

  async refreshToken(creds) {
    if (creds.kind !== 'oauth2' || !creds.refreshToken) {
      throw new Error('microsoft-calendar.refreshToken: missing refresh token')
    }
    const refreshed = await refreshAccessToken({
      tokenUrl: TOKEN_URL,
      clientId,
      clientSecret,
      refreshToken: creds.refreshToken,
    })
    return {
      kind: 'oauth2',
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? creds.refreshToken,
      expiresAt: refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined,
    }
  },

  async test(source) {
    try {
      const accessToken = await ensureFreshAccessToken(source.credentials, clientId, clientSecret)
      // Cheapest possible Graph call that proves the grant: GET /me.
      const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id', {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: `Microsoft rejected token (${res.status}) — reconnect required` }
      }
      if (!res.ok) return { ok: false, reason: `Microsoft Graph returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

interface BusyWindow {
  start: string
  end: string
}

/** Graph's getSchedule returns scheduleItems[].status in {free, busy,
 *  tentative, oof, workingElsewhere, unknown}. We treat anything other
 *  than 'free' as busy — same conservative reading Outlook uses. */
async function getScheduleBusy(input: {
  accessToken: string
  userPrincipal: string
  timeMin: string
  timeMax: string
}): Promise<BusyWindow[]> {
  // 'me' shorthand only resolves on /me/calendar/getSchedule; if a
  // specific UPN was pinned in metadata we'd have to use the user-id
  // form. /me/calendar/getSchedule with schedules=[upn or 'me'] handles
  // both.
  const target = input.userPrincipal === 'me' ? 'me' : input.userPrincipal
  const url = 'https://graph.microsoft.com/v1.0/me/calendar/getSchedule'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      schedules: [target],
      startTime: { dateTime: input.timeMin, timeZone: 'UTC' },
      endTime: { dateTime: input.timeMax, timeZone: 'UTC' },
      availabilityViewInterval: 30,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, '')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`microsoft-calendar getSchedule ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    value?: Array<{
      scheduleItems?: Array<{
        status?: string
        start?: { dateTime: string }
        end?: { dateTime: string }
      }>
    }>
  }
  const items = json.value?.[0]?.scheduleItems ?? []
  return items
    .filter(it => it.status && it.status !== 'free' && it.start && it.end)
    .map(it => ({ start: it.start!.dateTime, end: it.end!.dateTime }))
}

async function findNextFreeSlots(input: {
  accessToken: string
  userPrincipal: string
  searchFromMs: number
  durationMs: number
  wanted: number
}): Promise<BusyWindow[]> {
  const horizonMs = input.searchFromMs + 14 * 24 * 60 * 60 * 1000
  const out: BusyWindow[] = []
  let cursor = input.searchFromMs
  while (cursor < horizonMs && out.length < input.wanted) {
    const windowEnd = Math.min(cursor + 24 * 60 * 60 * 1000, horizonMs)
    const busy = await getScheduleBusy({
      accessToken: input.accessToken,
      userPrincipal: input.userPrincipal,
      timeMin: new Date(cursor).toISOString(),
      timeMax: new Date(windowEnd).toISOString(),
    })
    const norm = busy
      .map(b => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
      .filter(b => Number.isFinite(b.s) && Number.isFinite(b.e))
      .sort((a, b) => a.s - b.s)
    let pos = cursor
    for (const b of norm) {
      if (out.length >= input.wanted) break
      if (b.s > pos && b.s - pos >= input.durationMs) {
        out.push({ start: new Date(pos).toISOString(), end: new Date(pos + input.durationMs).toISOString() })
      }
      pos = Math.max(pos, b.e)
    }
    if (out.length < input.wanted && windowEnd - pos >= input.durationMs) {
      out.push({ start: new Date(pos).toISOString(), end: new Date(pos + input.durationMs).toISOString() })
    }
    cursor = windowEnd
  }
  return out.slice(0, input.wanted)
}

async function ensureFreshAccessToken(creds: ConnectorCredentials, clientId: string, clientSecret: string): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('microsoft-calendar: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Microsoft Calendar access token expired and no refresh token', '')
  }
  const refreshed = await refreshAccessToken({
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    refreshToken: creds.refreshToken,
  })
  creds.accessToken = refreshed.accessToken
  creds.expiresAt = refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined
  if (refreshed.refreshToken) creds.refreshToken = refreshed.refreshToken
  return creds.accessToken
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`microsoft-calendar DataSource.metadata.${key} is missing`)
  }
  return v
}
