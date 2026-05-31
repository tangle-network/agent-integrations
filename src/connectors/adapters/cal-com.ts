import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Cal.com Platform API v2 — managed scheduling. Auth is OAuth2 via the
 * Cal.com Platform program (developer.cal.com / Cal Atoms). The token
 * endpoint is exposed under `/v2/oauth/{clientId}/exchange`; the OAuth
 * runtime substitutes the client id from `CALCOM_OAUTH_CLIENT_ID` before
 * issuing the exchange call, so the manifest carries the canonical
 * `/v2/oauth/exchange` form here.
 *
 * The access token is a Bearer credential and every API call MUST also
 * carry a `cal-api-version` header (Cal pins capability shape per version
 * — without it the v2 surface 400s). Per-call versions can override the
 * default by templating into the request headers; the default below
 * matches the GA bookings/event-types surface as of 2024-08-13.
 */
const authorizeUrl = 'https://app.cal.com/auth/oauth2/authorize'
const tokenUrl = 'https://api.cal.com/v2/oauth/exchange'

export const calComConnector = declarativeRestConnector({
  kind: 'cal-com',
  displayName: 'Cal.com',
  description: 'Schedule, query, and cancel Cal.com bookings and read event types through the Platform v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: authorizeUrl,
    tokenUrl: tokenUrl,
    scopes: [
      'READ_PROFILE',
      'READ_BOOKING',
      'WRITE_BOOKING',
      'READ_EVENT_TYPE',
      'READ_SCHEDULE',
    ],
    clientIdEnv: 'CALCOM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'CALCOM_OAUTH_CLIENT_SECRET',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.cal.com',
  defaultHeaders: {
    'cal-api-version': '2024-08-13',
  },
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
      requiredScopes: ['READ_PROFILE'],
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
        query: { username: '{username}', eventSlug: '{eventSlug}' },
      },
      requiredScopes: ['READ_EVENT_TYPE'],
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
      request: { method: 'GET', path: '/v2/event-types/{eventTypeId}' },
      requiredScopes: ['READ_EVENT_TYPE'],
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
          take: { type: 'integer', minimum: 1, maximum: 250, description: 'Page size; default 100.' },
          skip: { type: 'integer', minimum: 0, description: 'Records to skip for pagination.' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/bookings',
        query: {
          status: '{status}',
          attendeeEmail: '{attendeeEmail}',
          eventTypeId: '{eventTypeId}',
          take: '{take}',
          skip: '{skip}',
        },
      },
      requiredScopes: ['READ_BOOKING'],
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
      request: { method: 'GET', path: '/v2/bookings/{bookingUid}' },
      requiredScopes: ['READ_BOOKING'],
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
      request: { method: 'POST', path: '/v2/bookings', body: 'args' },
      cas: 'native-idempotency',
      requiredScopes: ['WRITE_BOOKING'],
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
        body: { cancellationReason: '{cancellationReason}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['WRITE_BOOKING'],
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
        body: {
          start: '{start}',
          reschedulingReason: '{reschedulingReason}',
          rescheduledBy: '{rescheduledBy}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['WRITE_BOOKING'],
    },
    {
      name: 'schedules.list',
      class: 'read',
      description: 'List availability schedules for the authenticated user.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v2/schedules' },
      requiredScopes: ['READ_SCHEDULE'],
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
      requiredScopes: ['READ_EVENT_TYPE'],
    },
  ],
})
