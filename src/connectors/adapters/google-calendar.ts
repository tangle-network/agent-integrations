/**
 * Google Calendar connector — CAS reference implementation.
 *
 * Scopes: `https://www.googleapis.com/auth/calendar` covers list/insert/
 * patch on the user's calendars. We could split read/write but for v1 the
 * single scope keeps the consent screen simple; an operator who wants
 * read-only-Calendar can pick a different `kind` later (`google-calendar-readonly`).
 *
 * The two capabilities the agent actually needs:
 *
 *   list_availability(calendarId, timeMin, timeMax)
 *     → {busy: [{start, end}], events: [{id, etag, start, end, summary}]}
 *     Read; no CAS. Cheap (events.list).
 *
 *   book_slot(calendarId, start, end, summary, attendees?)
 *     → {eventId, etag}
 *     Mutation. CAS by Calendar's own conflict-detection: we re-list
 *     events for the requested window inside the same call, and if any
 *     OVERLAP exists we return `conflict` with the next-3 free slots
 *     mined from the user's freebusy, instead of inserting.
 *
 * Why pre-flight read-then-insert rather than relying on If-Match:
 * `events.insert` doesn't take If-Match (you can't precondition an
 * insert against a non-existent resource). Calendar's own
 * `freebusy.query` is the canonical conflict signal. The whole flow is:
 *
 *   1. freebusy.query for [start, end] on this calendarId
 *   2. if busy → emit ResourceContention with next-3 free slots
 *      (computed by walking forward in 30-min steps until 3 free
 *      windows of (end-start) duration found)
 *   3. else events.insert with idempotency-key as `requestId` (a Calendar
 *      API feature that gives us per-key dedup at upstream)
 *
 * Step 3's `requestId` parameter means a retry of the same idempotency
 * key on the same calendar will return the original event rather than
 * creating a duplicate, which composes correctly with our MutationGuard's
 * idempotency record (which short-circuits before ever hitting upstream
 * on the second call). Defense-in-depth.
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
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../oauth.js'

// `/auth/calendar` is the legacy broad scope (covers calendars + events).
// `/auth/calendar.events` is the fine-grained equivalent for the event-CRUD
// surface (create/get/list/patch/delete on events). We request both so a
// fresh OAuth grant lands the narrow scope alongside the broad one — when
// Google promotes the narrow scope to required for unverified apps, existing
// connections that reconnect will already have it.
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar'
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events'
const SCOPES = [SCOPE_CALENDAR, SCOPE_WRITE]
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL_API = 'https://www.googleapis.com/calendar/v3'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface GoogleCalendarOptions {
  clientId: string
  clientSecret: string
}

export function googleCalendar(opts: GoogleCalendarOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    kind: 'google-calendar',
    displayName: 'Google Calendar',
    description:
      "Let your agent check availability and book against a Google Calendar. Conflict-resolved: two callers can't grab the same slot — the second one is offered the next free time.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
      extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    },
    category: 'calendar',
    defaultConsistencyModel: 'authoritative',
    // Google Calendar's per-project quota is ~600 req/min before
    // throttling kicks in (Calendar API "Queries per minute per user",
    // shared per OAuth client). We meter at that rate locally so the
    // FIRST chatty agent doesn't push the shared client into Google's
    // throttle pool and degrade everyone else's quota.
    rateLimit: { requests: 600, windowMs: 60_000, scope: 'oauth-client' },
    capabilities: [
      {
        name: 'list_availability',
        class: 'read',
        description:
          'Look up busy/free times on the connected calendar between timeMin and timeMax (RFC3339 timestamps).',
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'RFC3339 lower bound (inclusive)' },
            timeMax: { type: 'string', description: 'RFC3339 upper bound (exclusive)' },
          },
          required: ['timeMin', 'timeMax'],
        },
      },
      {
        name: 'book_slot',
        class: 'mutation',
        description:
          'Reserve a time window on the connected calendar. Returns conflict + alternatives if the slot is no longer free.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'RFC3339 start time' },
            end: { type: 'string', description: 'RFC3339 end time' },
            summary: { type: 'string', description: 'Event title shown on the calendar' },
            description: { type: 'string', description: 'Optional event description' },
            attendees: {
              type: 'array',
              items: { type: 'string', description: 'email' },
            },
          },
          required: ['start', 'end', 'summary'],
        },
      },
      {
        name: 'create_event',
        class: 'mutation',
        description:
          "Create an event on the connected calendar without freebusy pre-flight. Use book_slot when the caller wants conflict-detection; use create_event when the caller already owns the slot decision (e.g. user-driven booking flows).",
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_WRITE],
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'RFC3339 start time' },
            end: { type: 'string', description: 'RFC3339 end time' },
            summary: { type: 'string', description: 'Event title shown on the calendar' },
            description: { type: 'string', description: 'Optional event description' },
            location: { type: 'string', description: 'Optional event location' },
            attendees: {
              type: 'array',
              items: { type: 'string', description: 'email' },
            },
            sendUpdates: {
              type: 'string',
              enum: ['all', 'externalOnly', 'none'],
              default: 'none',
              description: 'Whether Google sends invite emails to attendees.',
            },
          },
          required: ['start', 'end', 'summary'],
        },
      },
      {
        name: 'update_event',
        class: 'mutation',
        description:
          "Patch an existing event by id. Only the supplied fields are updated (PATCH semantics).",
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_WRITE],
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            start: { type: 'string', description: 'RFC3339 start time' },
            end: { type: 'string', description: 'RFC3339 end time' },
            summary: { type: 'string' },
            description: { type: 'string' },
            location: { type: 'string' },
            attendees: {
              type: 'array',
              items: { type: 'string', description: 'email' },
            },
            sendUpdates: {
              type: 'string',
              enum: ['all', 'externalOnly', 'none'],
              default: 'none',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'delete_event',
        class: 'mutation',
        description:
          "Delete an event by id. Returns {ok:true} on success; treats 404 and 410 (already-deleted) as idempotent success.",
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_WRITE],
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
            sendUpdates: {
              type: 'string',
              enum: ['all', 'externalOnly', 'none'],
              default: 'none',
            },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'get_event',
        class: 'read',
        description:
          'Fetch a single event by id, including iCal-style fields (htmlLink, hangoutLink, attendees, status, etag).',
        requiredScopes: [SCOPE_WRITE],
        parameters: {
          type: 'object',
          properties: {
            eventId: { type: 'string' },
          },
          required: ['eventId'],
        },
      },
      {
        name: 'list_events',
        class: 'read',
        description:
          "List events between timeMin and timeMax (RFC3339). Optional free-text search (`q`) and maxResults paging. Returns ordered items + nextPageToken.",
        requiredScopes: [SCOPE_WRITE],
        parameters: {
          type: 'object',
          properties: {
            timeMin: { type: 'string', description: 'RFC3339 lower bound (inclusive)' },
            timeMax: { type: 'string', description: 'RFC3339 upper bound (exclusive)' },
            q: { type: 'string', description: 'Free-text search query (summary, description, location, attendees).' },
            maxResults: { type: 'integer', minimum: 1, maximum: 2500, default: 50 },
            pageToken: { type: 'string' },
            singleEvents: { type: 'boolean', default: true, description: 'Expand recurring events.' },
            orderBy: { type: 'string', enum: ['startTime', 'updated'], default: 'startTime' },
          },
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    if (inv.capabilityName === 'list_availability') {
      const calendarId = readMetaString(inv.source.metadata, 'calendarId')
      const { timeMin, timeMax } = inv.args as { timeMin: string; timeMax: string }
      const fb = await freebusyQuery({ accessToken, calendarId, timeMin, timeMax })
      return {
        data: { busy: fb.busy },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'get_event') return getEvent(inv, accessToken, 15_000)
    if (inv.capabilityName === 'list_events') return listEvents(inv, accessToken, 15_000)
    throw new Error(`google-calendar: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    if (inv.capabilityName === 'create_event') return createEvent(inv, accessToken, 15_000)
    if (inv.capabilityName === 'update_event') return updateEvent(inv, accessToken, 15_000)
    if (inv.capabilityName === 'delete_event') return deleteEvent(inv, accessToken, 15_000)
    if (inv.capabilityName !== 'book_slot') {
      throw new Error(`google-calendar: unknown mutation capability ${inv.capabilityName}`)
    }
    const calendarId = readMetaString(inv.source.metadata, 'calendarId')
    const { start, end, summary, description, attendees } = inv.args as {
      start: string
      end: string
      summary: string
      description?: string
      attendees?: string[]
    }

    // Pre-flight: is the requested window busy?
    const fb = await freebusyQuery({ accessToken, calendarId, timeMin: start, timeMax: end })
    if (fb.busy.length > 0) {
      const startMs = Date.parse(start)
      const endMs = Date.parse(end)
      const durMs = endMs - startMs
      const alternatives = await findNextFreeSlots({
        accessToken,
        calendarId,
        searchFromMs: endMs,
        durationMs: durMs,
        wanted: 3,
      })
      throw new ResourceContention(
        `requested slot ${start}–${end} is no longer free`,
        alternatives,
        { busy: fb.busy },
      )
    }

    // Insert. requestId == idempotencyKey gives upstream-side dedup.
    // Calendar requires it to be ≤1024 chars and ASCII.
    const requestId = inv.idempotencyKey.replace(/[^a-zA-Z0-9_:.-]/g, '_').slice(0, 1024)
    const event = {
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end },
      attendees: attendees?.map(email => ({ email })),
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=0&sendUpdates=none&requestId=${encodeURIComponent(requestId)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (res.status === 409) {
      // Calendar reports duplicate; return as committed by treating the
      // recovered event as the response (idempotent semantics).
      const dup = (await res.json().catch(() => ({}))) as { id?: string; etag?: string }
      return {
        status: 'committed',
        data: dup,
        etagAfter: dup.etag,
        committedAt: Date.now(),
        idempotentReplay: true,
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`google-calendar book_slot ${res.status}: ${text.slice(0, 200)}`)
    }
    const created = (await res.json()) as { id: string; etag: string; htmlLink?: string }
    return {
      status: 'committed',
      data: { eventId: created.id, htmlLink: created.htmlLink },
      etagAfter: created.etag,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async exchangeOAuth(input) {
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: TOKEN_URL,
      clientId,
      clientSecret,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
    })
    // Pin which calendar this connection points at. Default to the
    // user's primary; the UI lets the user pick a different calendar
    // post-connect by patching DataSource.metadata.calendarId.
    return {
      credentials: {
        kind: 'oauth2',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
      },
      scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
      metadata: { calendarId: 'primary' },
    }
  },

  async refreshToken(creds) {
    if (creds.kind !== 'oauth2' || !creds.refreshToken) {
      throw new Error('google-calendar.refreshToken: missing refresh token')
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
      const calendarId = readMetaString(source.metadata, 'calendarId')
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: `Google rejected token (${res.status}) — reconnect required` }
      }
      if (!res.ok) return { ok: false, reason: `Google returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

/** Resolve calendarId for the event-CRUD capabilities. Unlike the
 *  legacy `book_slot` / `list_availability` pair (which require
 *  metadata.calendarId), these accept the id in args and fall back to
 *  metadata, then to `'primary'`. */
function resolveCalendarId(inv: ConnectorInvocation): string {
  const fromArgs = (inv.args as { calendarId?: unknown } | undefined)?.calendarId
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs
  const fromMeta = inv.source.metadata?.calendarId
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
  return 'primary'
}

async function createEvent(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = inv.args as {
    start?: string
    end?: string
    summary?: string
    description?: string
    location?: string
    attendees?: string[]
    sendUpdates?: 'all' | 'externalOnly' | 'none'
  }
  if (!args.start) throw new Error('google-calendar create_event: `start` is required')
  if (!args.end) throw new Error('google-calendar create_event: `end` is required')
  if (!args.summary) throw new Error('google-calendar create_event: `summary` is required')

  const calendarId = resolveCalendarId(inv)
  // requestId == idempotencyKey gives upstream-side dedup.
  // Calendar requires ≤1024 chars and ASCII.
  const requestId = inv.idempotencyKey.replace(/[^a-zA-Z0-9_:.-]/g, '_').slice(0, 1024)
  const sendUpdates = args.sendUpdates ?? 'none'
  const event: Record<string, unknown> = {
    summary: args.summary,
    description: args.description,
    location: args.location,
    start: { dateTime: args.start },
    end: { dateTime: args.end },
  }
  if (args.attendees?.length) {
    event.attendees = args.attendees.map((email) => ({ email }))
  }

  const url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${encodeURIComponent(sendUpdates)}&requestId=${encodeURIComponent(requestId)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-calendar create_event ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as {
    id: string
    etag: string
    htmlLink?: string
    hangoutLink?: string
    status?: string
  }
  return {
    status: 'committed',
    data: {
      eventId: created.id,
      htmlLink: created.htmlLink,
      hangoutLink: created.hangoutLink,
      eventStatus: created.status,
    },
    etagAfter: created.etag,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function updateEvent(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = inv.args as {
    eventId?: string
    start?: string
    end?: string
    summary?: string
    description?: string
    location?: string
    attendees?: string[]
    sendUpdates?: 'all' | 'externalOnly' | 'none'
  }
  if (!args.eventId) throw new Error('google-calendar update_event: `eventId` is required')

  const calendarId = resolveCalendarId(inv)
  const sendUpdates = args.sendUpdates ?? 'none'
  // PATCH semantics — only include fields the caller supplied so we don't
  // clobber server-side state.
  const patch: Record<string, unknown> = {}
  if (args.summary !== undefined) patch.summary = args.summary
  if (args.description !== undefined) patch.description = args.description
  if (args.location !== undefined) patch.location = args.location
  if (args.start !== undefined) patch.start = { dateTime: args.start }
  if (args.end !== undefined) patch.end = { dateTime: args.end }
  if (args.attendees !== undefined) {
    patch.attendees = args.attendees.map((email) => ({ email }))
  }

  const url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(args.eventId)}?sendUpdates=${encodeURIComponent(sendUpdates)}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-calendar update_event ${res.status}: ${text.slice(0, 200)}`)
  }
  const updated = (await res.json()) as {
    id: string
    etag: string
    htmlLink?: string
    status?: string
  }
  return {
    status: 'committed',
    data: {
      eventId: updated.id,
      htmlLink: updated.htmlLink,
      eventStatus: updated.status,
    },
    etagAfter: updated.etag,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function deleteEvent(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = inv.args as {
    eventId?: string
    sendUpdates?: 'all' | 'externalOnly' | 'none'
  }
  if (!args.eventId) throw new Error('google-calendar delete_event: `eventId` is required')

  const calendarId = resolveCalendarId(inv)
  const sendUpdates = args.sendUpdates ?? 'none'
  const url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(args.eventId)}?sendUpdates=${encodeURIComponent(sendUpdates)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
  }
  // 404 = already gone, 410 = "resource has been deleted" — both are
  // idempotent success from the caller's perspective.
  const idempotent = res.status === 404 || res.status === 410
  if (!res.ok && !idempotent) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-calendar delete_event ${res.status}: ${text.slice(0, 200)}`)
  }
  return {
    status: 'committed',
    data: { ok: true, eventId: args.eventId },
    committedAt: Date.now(),
    idempotentReplay: idempotent,
  }
}

async function getEvent(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = inv.args as { eventId?: string }
  if (!args.eventId) throw new Error('google-calendar get_event: `eventId` is required')

  const calendarId = resolveCalendarId(inv)
  const url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(args.eventId)}`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-calendar get_event ${res.status}: ${text.slice(0, 200)}`)
  }
  const event = (await res.json()) as Record<string, unknown>
  return {
    data: event,
    fetchedAt: Date.now(),
  }
}

async function listEvents(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = (inv.args ?? {}) as {
    timeMin?: string
    timeMax?: string
    q?: string
    maxResults?: number
    pageToken?: string
    singleEvents?: boolean
    orderBy?: 'startTime' | 'updated'
  }
  const calendarId = resolveCalendarId(inv)
  const params = new URLSearchParams()
  params.set('maxResults', String(args.maxResults ?? 50))
  params.set('singleEvents', String(args.singleEvents ?? true))
  // Calendar requires singleEvents=true when ordering by startTime; default
  // to startTime when singleEvents is true (or unspecified), else updated.
  const wantStartTime = args.orderBy === 'startTime' || (args.orderBy === undefined && (args.singleEvents ?? true))
  params.set('orderBy', wantStartTime ? 'startTime' : (args.orderBy ?? 'updated'))
  if (args.timeMin) params.set('timeMin', args.timeMin)
  if (args.timeMax) params.set('timeMax', args.timeMax)
  if (args.q) params.set('q', args.q)
  if (args.pageToken) params.set('pageToken', args.pageToken)

  const url = `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Calendar rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-calendar list_events ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    items?: Array<Record<string, unknown>>
    nextPageToken?: string
    nextSyncToken?: string
  }
  return {
    data: {
      items: json.items ?? [],
      nextPageToken: json.nextPageToken,
      nextSyncToken: json.nextSyncToken,
    },
    fetchedAt: Date.now(),
  }
}

interface FreeBusyResult {
  busy: Array<{ start: string; end: string }>
}

async function freebusyQuery(input: {
  accessToken: string
  calendarId: string
  timeMin: string
  timeMax: string
}): Promise<FreeBusyResult> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      items: [{ id: input.calendarId }],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`freebusy ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
  }
  return { busy: json.calendars?.[input.calendarId]?.busy ?? [] }
}

/** Given a starting point and a duration, walk forward looking up
 *  freebusy in 24-hour windows, mining (wanted) free slots that are at
 *  least durationMs long. Stops at a horizon of 14 days from search
 *  start — past that and the agent should propose a different day. */
async function findNextFreeSlots(input: {
  accessToken: string
  calendarId: string
  searchFromMs: number
  durationMs: number
  wanted: number
}): Promise<Array<{ start: string; end: string }>> {
  const horizonMs = input.searchFromMs + 14 * 24 * 60 * 60 * 1000
  const out: Array<{ start: string; end: string }> = []
  let cursor = input.searchFromMs
  // Step the search window 1 day at a time.
  while (cursor < horizonMs && out.length < input.wanted) {
    const windowEnd = Math.min(cursor + 24 * 60 * 60 * 1000, horizonMs)
    const fb = await freebusyQuery({
      accessToken: input.accessToken,
      calendarId: input.calendarId,
      timeMin: new Date(cursor).toISOString(),
      timeMax: new Date(windowEnd).toISOString(),
    })
    // Walk through free intervals between busy spans inside this window.
    const busy = fb.busy
      .map(b => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
      .filter(b => Number.isFinite(b.s) && Number.isFinite(b.e))
      .sort((a, b) => a.s - b.s)
    let pos = cursor
    for (const b of busy) {
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

/** If access token is missing or expired, refresh it. Caller is
 *  responsible for persisting the rotated envelope back to the row —
 *  for now we mutate the in-memory copy so this single call works, and
 *  the route layer handles the persistence on call-completion. */
async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('google-calendar: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Google Calendar access token expired and no refresh token', '')
  }
  const refreshed = await refreshAccessToken({
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    refreshToken: creds.refreshToken,
  })
  // Mutate so the caller within this request sees the fresh token; the
  // persisting write happens at the route layer on completion.
  creds.accessToken = refreshed.accessToken
  creds.expiresAt = refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined
  if (refreshed.refreshToken) creds.refreshToken = refreshed.refreshToken
  return creds.accessToken
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`google-calendar DataSource.metadata.${key} is missing`)
  }
  return v
}
