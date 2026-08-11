import {
  CredentialsExpired,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'
import {
  declarativeRestConnector,
  type RestConnectorSpec,
} from './declarative-rest.js'

/**
 * Cal.com Platform API v2 — managed scheduling. Auth is OAuth2 via the
 * Cal.com Platform program (developer.cal.com / Cal Atoms). The token
 * endpoint is the RFC 6749-compatible `/v2/auth/oauth2/token` route.
 *
 * The access token is a Bearer credential and every API call MUST also
 * carry the endpoint's `cal-api-version` header. Cal.com versions individual
 * endpoint families independently, so each request pins the version its
 * request and response shape implements.
 */
const authorizeUrl = 'https://app.cal.com/auth/oauth2/authorize'
const tokenUrl = 'https://api.cal.com/v2/auth/oauth2/token'

const calComSpec = {
  kind: 'cal-com',
  displayName: 'Cal.com',
  description: 'Schedule, query, and cancel Cal.com bookings and read event types through the Platform v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: authorizeUrl,
    tokenUrl: tokenUrl,
    scopes: [
      'PROFILE_READ',
      'BOOKING_READ',
      'BOOKING_WRITE',
      'EVENT_TYPE_READ',
      'EVENT_TYPE_WRITE',
      'SCHEDULE_READ',
      'SCHEDULE_WRITE',
    ],
    pkce: 'required',
    tokenClientAuthMethod: 'none',
    clientIdEnv: 'CALCOM_OAUTH_CLIENT_ID',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cal.com',
  test: { method: 'GET', path: '/v2/me' },
  capabilities: [
    {
      name: 'me.get',
      class: 'read',
      description: 'Read the authenticated Cal.com user (managed user under the Platform client).',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v2/me' },
      requiredScopes: ['PROFILE_READ'],
    },
    {
      name: 'event-types.list',
      class: 'read',
      description: 'List event types owned by the authenticated user or a given username.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Optional Cal.com username to filter event types.' },
          eventSlug: { type: 'string', description: 'Optional event-type slug to filter.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/event-types',
        headers: { 'cal-api-version': '2024-06-14' },
        query: { username: '{username}', eventSlug: '{eventSlug}' },
      },
      requiredScopes: ['EVENT_TYPE_READ'],
    },
    {
      name: 'event-types.get',
      class: 'read',
      description: 'Read a single event type by numeric id.',
      parameters: {
        type: 'object',
        properties: { eventTypeId: { type: 'string' } },
        required: ['eventTypeId'],
      },
      request: {
        method: 'GET',
        path: '/v2/event-types/{eventTypeId}',
        headers: { 'cal-api-version': '2024-06-14' },
      },
      requiredScopes: ['EVENT_TYPE_READ'],
    },
    {
      name: 'bookings.list',
      class: 'read',
      description: 'List Cal.com bookings, optionally filtered by status, attendee email, or event-type id.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status (upcoming, recurring, past, cancelled, unconfirmed).',
          },
          attendeeEmail: { type: 'string' },
          eventTypeId: { type: 'string' },
          limit: { type: 'integer', minimum: 1, description: 'Page size.' },
          cursor: { type: 'string', description: 'The previous page response pagination.nextCursor.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/bookings',
        headers: { 'cal-api-version': '2026-05-01' },
        query: {
          status: '{status}',
          attendeeEmail: '{attendeeEmail}',
          eventTypeId: '{eventTypeId}',
          limit: '{limit}',
          cursor: '{cursor}',
        },
      },
      requiredScopes: ['BOOKING_READ'],
    },
    {
      name: 'bookings.get',
      class: 'read',
      description: 'Read a single booking by its public uid.',
      parameters: {
        type: 'object',
        properties: { bookingUid: { type: 'string' } },
        required: ['bookingUid'],
      },
      request: {
        method: 'GET',
        path: '/v2/bookings/{bookingUid}',
        headers: { 'cal-api-version': '2026-02-25' },
      },
      requiredScopes: ['BOOKING_READ'],
    },
    {
      name: 'bookings.create',
      class: 'mutation',
      description: 'Create a Cal.com booking. The body shape follows the v2 bookings contract (eventTypeId, start, attendee, etc.).',
      parameters: {
        type: 'object',
        properties: {
          eventTypeId: { type: 'integer', description: 'Numeric event-type id to book against.' },
          start: { type: 'string', description: 'ISO-8601 start time in the attendee timezone.' },
          attendee: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              timeZone: { type: 'string' },
              language: { type: 'string' },
              phoneNumber: { type: 'string' },
            },
            required: ['name', 'email', 'timeZone'],
          },
          guests: { type: 'array', items: { type: 'string' } },
          meetingUrl: { type: 'string' },
          location: { type: 'string' },
          bookingFieldsResponses: { type: 'object' },
          metadata: { type: 'object' },
          lengthInMinutes: { type: 'integer' },
        },
        required: ['eventTypeId', 'start', 'attendee'],
      },
      request: {
        method: 'POST',
        path: '/v2/bookings',
        headers: { 'cal-api-version': '2026-02-25' },
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['BOOKING_WRITE'],
    },
    {
      name: 'event-types.create',
      class: 'mutation',
      description: 'Create a Cal.com event type owned by the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          slug: { type: 'string' },
          lengthInMinutes: { type: 'integer' },
          description: { type: 'string' },
          locations: { type: 'array', items: { type: 'object' } },
          bookingFields: { type: 'array', items: { type: 'object' } },
          disableGuests: { type: 'boolean' },
        },
        required: ['title', 'slug', 'lengthInMinutes'],
      },
      request: {
        method: 'POST',
        path: '/v2/event-types',
        headers: { 'cal-api-version': '2024-06-14' },
        body: {
          title: '{title}',
          slug: '{slug}',
          lengthInMinutes: '{lengthInMinutes}',
          description: '{description}',
          locations: '{locations}',
          bookingFields: '{bookingFields}',
          disableGuests: '{disableGuests}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['EVENT_TYPE_WRITE'],
    },
    {
      name: 'event-types.delete',
      class: 'mutation',
      description: 'Delete a Cal.com event type by numeric id.',
      parameters: {
        type: 'object',
        properties: { eventTypeId: { type: 'string' } },
        required: ['eventTypeId'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/event-types/{eventTypeId}',
        headers: { 'cal-api-version': '2024-06-14' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['EVENT_TYPE_WRITE'],
    },
    {
      name: 'schedules.create',
      class: 'mutation',
      description: 'Create an availability schedule for the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          timeZone: { type: 'string' },
          isDefault: { type: 'boolean' },
          availability: { type: 'array', items: { type: 'object' } },
          overrides: { type: 'array', items: { type: 'object' } },
        },
        required: ['name', 'timeZone'],
      },
      request: {
        method: 'POST',
        path: '/v2/schedules',
        headers: { 'cal-api-version': '2024-06-11' },
        body: {
          name: '{name}',
          timeZone: '{timeZone}',
          isDefault: '{isDefault}',
          availability: '{availability}',
          overrides: '{overrides}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['SCHEDULE_WRITE'],
    },
    {
      name: 'bookings.cancel',
      class: 'mutation',
      description: 'Cancel a Cal.com booking by uid with an optional cancellation reason.',
      parameters: {
        type: 'object',
        properties: {
          bookingUid: { type: 'string' },
          cancellationReason: { type: 'string' },
        },
        required: ['bookingUid'],
      },
      request: {
        method: 'POST',
        path: '/v2/bookings/{bookingUid}/cancel',
        headers: { 'cal-api-version': '2026-02-25' },
        body: { cancellationReason: '{cancellationReason}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['BOOKING_WRITE'],
    },
    {
      name: 'bookings.reschedule',
      class: 'mutation',
      description: 'Reschedule a Cal.com booking to a new start time, returning the new booking uid.',
      parameters: {
        type: 'object',
        properties: {
          bookingUid: { type: 'string' },
          start: { type: 'string', description: 'ISO-8601 start time for the new slot.' },
          reschedulingReason: { type: 'string' },
          rescheduledBy: { type: 'string', description: 'Email of the actor rescheduling.' },
        },
        required: ['bookingUid', 'start'],
      },
      request: {
        method: 'POST',
        path: '/v2/bookings/{bookingUid}/reschedule',
        headers: { 'cal-api-version': '2026-02-25' },
        body: {
          start: '{start}',
          reschedulingReason: '{reschedulingReason}',
          rescheduledBy: '{rescheduledBy}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['BOOKING_WRITE'],
    },
    {
      name: 'schedules.list',
      class: 'read',
      description: 'List availability schedules for the authenticated user.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: {
        method: 'GET',
        path: '/v2/schedules',
        headers: { 'cal-api-version': '2024-06-11' },
      },
      requiredScopes: ['SCHEDULE_READ'],
    },
    {
      name: 'slots.list',
      class: 'read',
      description: 'List bookable time slots for an event type in a date range.',
      parameters: {
        type: 'object',
        properties: {
          eventTypeId: { type: 'string' },
          eventTypeSlug: { type: 'string' },
          username: { type: 'string' },
          start: { type: 'string', description: 'ISO-8601 range start.' },
          end: { type: 'string', description: 'ISO-8601 range end.' },
          timeZone: { type: 'string' },
          duration: { type: 'integer' },
        },
        required: ['start', 'end'],
      },
      request: {
        method: 'GET',
        path: '/v2/slots',
        headers: { 'cal-api-version': '2024-09-04' },
        query: {
          eventTypeId: '{eventTypeId}',
          eventTypeSlug: '{eventTypeSlug}',
          username: '{username}',
          start: '{start}',
          end: '{end}',
          timeZone: '{timeZone}',
          duration: '{duration}',
        },
      },
      requiredScopes: ['EVENT_TYPE_READ'],
    },
  ],
} satisfies RestConnectorSpec

/** Runtime OAuth settings for the approved Cal.com public client. */
export interface CalComOptions {
  clientId: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Static connector used for manifest discovery and direct token execution. */
export const calComConnector = declarativeRestConnector(calComSpec)

/** Credential-bound connector used by the production factory. */
export function calCom(options: CalComOptions): ConnectorAdapter {
  const adapter = declarativeRestConnector(calComSpec)
  const now = options.now ?? Date.now
  const refreshes = new Map<string, Promise<ConnectorCredentials>>()
  adapter.exchangeOAuth = async (input) => {
    const tokens = await exchangeAuthorizationCode({
      tokenUrl,
      clientId: options.clientId,
      tokenClientAuthMethod: 'none',
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      fetchImpl: options.fetchImpl,
    })
    return {
      credentials: {
        kind: 'oauth2',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresIn
          ? now() + tokens.expiresIn * 1000
          : undefined,
      },
      scopes: tokens.scope?.split(/[\s,]+/).filter(Boolean) ?? calComSpec.auth.scopes,
      metadata: {},
    }
  }
  adapter.refreshToken = async (credentials) => {
    if (credentials.kind !== 'oauth2' || !credentials.refreshToken) {
      throw new Error('cal-com.refreshToken: missing refresh token')
    }
    const refreshed = await refreshAccessToken({
      tokenUrl,
      clientId: options.clientId,
      tokenClientAuthMethod: 'none',
      refreshToken: credentials.refreshToken,
      fetchImpl: options.fetchImpl,
    })
    return {
      kind: 'oauth2',
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
      expiresAt: refreshed.expiresIn
        ? now() + refreshed.expiresIn * 1000
        : undefined,
    }
  }
  const executeRead = adapter.executeRead?.bind(adapter)
  const executeMutation = adapter.executeMutation?.bind(adapter)
  if (executeRead) {
    adapter.executeRead = async (invocation) => executeRead(
      await withFreshCalComCredentials(invocation, adapter, refreshes, now),
    )
  }
  if (executeMutation) {
    adapter.executeMutation = async (invocation) => executeMutation(
      await withFreshCalComCredentials(invocation, adapter, refreshes, now),
    )
  }
  return adapter
}

async function withFreshCalComCredentials(
  invocation: ConnectorInvocation,
  adapter: ConnectorAdapter,
  refreshes: Map<string, Promise<ConnectorCredentials>>,
  now: () => number,
): Promise<ConnectorInvocation> {
  const credentials = invocation.source.credentials
  if (credentials.kind !== 'oauth2') {
    throw new CredentialsExpired('Cal.com requires OAuth2 credentials.', invocation.source.id)
  }
  if (!credentials.expiresAt || credentials.expiresAt > now() + 60_000) {
    return invocation
  }
  if (!credentials.refreshToken || !adapter.refreshToken) {
    throw new CredentialsExpired(
      'Cal.com access token expired and no refresh token is available.',
      invocation.source.id,
    )
  }

  let refresh = refreshes.get(invocation.source.id)
  if (!refresh) {
    refresh = adapter.refreshToken(credentials)
    refreshes.set(invocation.source.id, refresh)
    const clear = () => {
      if (refreshes.get(invocation.source.id) === refresh) {
        refreshes.delete(invocation.source.id)
      }
    }
    void refresh.then(clear, clear)
  }
  const rotated = await refresh
  await invocation.onCredentialsRotated?.(rotated)
  return {
    ...invocation,
    source: {
      ...invocation.source,
      credentials: rotated,
    },
  }
}
