import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Zoom API v2 — Bearer OAuth2 against api.zoom.us.
 *
 * Auth flow uses the user-level OAuth app type ("OAuth" / general app on the
 * Zoom Marketplace) — server-to-server JWT was deprecated in 2023, and the
 * Server-to-Server OAuth flow is a different OAuth app type that uses the same
 * token endpoint but a `grant_type=account_credentials` exchange; the user
 * flow below is the one the runtime drives for delegated user access.
 *
 * Scopes use Zoom's GRANULAR scope format (resource:action:scope), mandatory
 * for new app submissions since 2023 — the legacy `meeting:read` form still
 * resolves but is rejected on new app review. Capability scopes here are the
 * narrowest grant that satisfies the corresponding endpoint per
 * https://developers.zoom.us/docs/api/ .
 *
 * Meeting / webinar / user / recording resources are addressed by id under
 * /v2; `me` is the canonical alias for the authenticated user on user-scoped
 * paths.
 */
export const zoomConnector = declarativeRestConnector({
  kind: 'zoom',
  displayName: 'Zoom',
  description: 'Create and manage Zoom meetings, webinars, users, and cloud recordings via the Zoom API v2.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    scopes: [
      'user:read:user',
      'meeting:read:meeting',
      'meeting:write:meeting',
      'meeting:update:meeting',
      'meeting:delete:meeting',
      'webinar:read:webinar',
      'webinar:write:webinar',
      'recording:read:recording',
    ],
    clientIdEnv: 'ZOOM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ZOOM_OAUTH_CLIENT_SECRET',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.zoom.us',
  test: { method: 'GET', path: '/v2/users/me' },
  capabilities: [
    {
      name: 'users.get',
      class: 'read',
      description: 'Read a Zoom user by id, email, or the "me" alias for the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User id, email address, or "me".' },
        },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/v2/users/{userId}' },
      requiredScopes: ['user:read:user'],
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List users on the Zoom account.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
          page_size: { type: 'integer', minimum: 1, maximum: 300 },
          next_page_token: { type: 'string' },
          role_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/users',
        query: {
          status: '{status}',
          page_size: '{page_size}',
          next_page_token: '{next_page_token}',
          role_id: '{role_id}',
        },
      },
      requiredScopes: ['user:read:user'],
    },
    {
      name: 'meetings.list',
      class: 'read',
      description: 'List meetings for a user (scheduled, live, or upcoming).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User id, email, or "me".' },
          type: {
            type: 'string',
            enum: ['scheduled', 'live', 'upcoming', 'upcoming_meetings', 'previous_meetings'],
            description: 'Subset of meetings to return; defaults to scheduled.',
          },
          page_size: { type: 'integer', minimum: 1, maximum: 300 },
          next_page_token: { type: 'string' },
        },
        required: ['userId'],
      },
      request: {
        method: 'GET',
        path: '/v2/users/{userId}/meetings',
        query: {
          type: '{type}',
          page_size: '{page_size}',
          next_page_token: '{next_page_token}',
        },
      },
      requiredScopes: ['meeting:read:meeting'],
    },
    {
      name: 'meetings.get',
      class: 'read',
      description: 'Read a Zoom meeting by numeric meeting id.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'Numeric Zoom meeting id.' },
          occurrence_id: { type: 'string', description: 'Optional recurring-meeting occurrence id.' },
        },
        required: ['meetingId'],
      },
      request: {
        method: 'GET',
        path: '/v2/meetings/{meetingId}',
        query: { occurrence_id: '{occurrence_id}' },
      },
      requiredScopes: ['meeting:read:meeting'],
    },
    {
      name: 'meetings.create',
      class: 'mutation',
      description: 'Schedule a Zoom meeting for a user. Body follows the v2 meetings contract (topic, start_time, duration, type, settings, ...).',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User id, email, or "me".' },
          topic: { type: 'string' },
          type: {
            type: 'integer',
            enum: [1, 2, 3, 8],
            description: '1=instant, 2=scheduled, 3=recurring no fixed time, 8=recurring with fixed time.',
          },
          start_time: { type: 'string', description: 'ISO-8601 start time (UTC or with offset).' },
          duration: { type: 'integer', description: 'Meeting length in minutes.' },
          timezone: { type: 'string' },
          password: { type: 'string' },
          agenda: { type: 'string' },
          settings: { type: 'object' },
          recurrence: { type: 'object' },
          tracking_fields: { type: 'array', items: { type: 'object' } },
        },
        required: ['userId', 'topic'],
      },
      request: {
        method: 'POST',
        path: '/v2/users/{userId}/meetings',
        body: {
          topic: '{topic}',
          type: '{type}',
          start_time: '{start_time}',
          duration: '{duration}',
          timezone: '{timezone}',
          password: '{password}',
          agenda: '{agenda}',
          settings: '{settings}',
          recurrence: '{recurrence}',
          tracking_fields: '{tracking_fields}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['meeting:write:meeting'],
    },
    {
      name: 'meetings.update',
      class: 'mutation',
      description: 'Update a scheduled Zoom meeting in place.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string' },
          occurrence_id: { type: 'string' },
          topic: { type: 'string' },
          start_time: { type: 'string' },
          duration: { type: 'integer' },
          timezone: { type: 'string' },
          password: { type: 'string' },
          agenda: { type: 'string' },
          settings: { type: 'object' },
          recurrence: { type: 'object' },
        },
        required: ['meetingId'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/meetings/{meetingId}',
        query: { occurrence_id: '{occurrence_id}' },
        body: {
          topic: '{topic}',
          start_time: '{start_time}',
          duration: '{duration}',
          timezone: '{timezone}',
          password: '{password}',
          agenda: '{agenda}',
          settings: '{settings}',
          recurrence: '{recurrence}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['meeting:update:meeting'],
    },
    {
      name: 'meetings.delete',
      class: 'mutation',
      description: 'Delete a Zoom meeting. Optionally notify hosts/registrants and scope to a single occurrence.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string' },
          occurrence_id: { type: 'string' },
          schedule_for_reminder: { type: 'boolean' },
          cancel_meeting_reminder: { type: 'boolean' },
        },
        required: ['meetingId'],
      },
      request: {
        method: 'DELETE',
        path: '/v2/meetings/{meetingId}',
        query: {
          occurrence_id: '{occurrence_id}',
          schedule_for_reminder: '{schedule_for_reminder}',
          cancel_meeting_reminder: '{cancel_meeting_reminder}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['meeting:delete:meeting'],
    },
    {
      name: 'meetings.list-registrants',
      class: 'read',
      description: 'List registrants for a Zoom meeting.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string' },
          occurrence_id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'denied'] },
          page_size: { type: 'integer', minimum: 1, maximum: 300 },
          next_page_token: { type: 'string' },
        },
        required: ['meetingId'],
      },
      request: {
        method: 'GET',
        path: '/v2/meetings/{meetingId}/registrants',
        query: {
          occurrence_id: '{occurrence_id}',
          status: '{status}',
          page_size: '{page_size}',
          next_page_token: '{next_page_token}',
        },
      },
      requiredScopes: ['meeting:read:meeting'],
    },
    {
      name: 'meetings.add-registrant',
      class: 'mutation',
      description: 'Register a participant for a Zoom meeting that requires registration.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string' },
          occurrence_ids: { type: 'string', description: 'Comma-separated occurrence ids for recurring meetings.' },
          email: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string' },
          zip: { type: 'string' },
          state: { type: 'string' },
          phone: { type: 'string' },
          industry: { type: 'string' },
          org: { type: 'string' },
          job_title: { type: 'string' },
          purchasing_time_frame: { type: 'string' },
          role_in_purchase_process: { type: 'string' },
          no_of_employees: { type: 'string' },
          comments: { type: 'string' },
          custom_questions: { type: 'array', items: { type: 'object' } },
          language: { type: 'string' },
          auto_approve: { type: 'boolean' },
        },
        required: ['meetingId', 'email', 'first_name'],
      },
      request: {
        method: 'POST',
        path: '/v2/meetings/{meetingId}/registrants',
        query: { occurrence_ids: '{occurrence_ids}' },
        body: {
          email: '{email}',
          first_name: '{first_name}',
          last_name: '{last_name}',
          address: '{address}',
          city: '{city}',
          country: '{country}',
          zip: '{zip}',
          state: '{state}',
          phone: '{phone}',
          industry: '{industry}',
          org: '{org}',
          job_title: '{job_title}',
          purchasing_time_frame: '{purchasing_time_frame}',
          role_in_purchase_process: '{role_in_purchase_process}',
          no_of_employees: '{no_of_employees}',
          comments: '{comments}',
          custom_questions: '{custom_questions}',
          language: '{language}',
          auto_approve: '{auto_approve}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['meeting:write:meeting'],
    },
    {
      name: 'webinars.list',
      class: 'read',
      description: 'List webinars for a user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 300 },
          next_page_token: { type: 'string' },
        },
        required: ['userId'],
      },
      request: {
        method: 'GET',
        path: '/v2/users/{userId}/webinars',
        query: {
          page_size: '{page_size}',
          next_page_token: '{next_page_token}',
        },
      },
      requiredScopes: ['webinar:read:webinar'],
    },
    {
      name: 'webinars.get',
      class: 'read',
      description: 'Read a Zoom webinar by id.',
      parameters: {
        type: 'object',
        properties: {
          webinarId: { type: 'string' },
          occurrence_id: { type: 'string' },
        },
        required: ['webinarId'],
      },
      request: {
        method: 'GET',
        path: '/v2/webinars/{webinarId}',
        query: { occurrence_id: '{occurrence_id}' },
      },
      requiredScopes: ['webinar:read:webinar'],
    },
    {
      name: 'webinars.create',
      class: 'mutation',
      description: 'Schedule a Zoom webinar for a user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          topic: { type: 'string' },
          type: {
            type: 'integer',
            enum: [5, 6, 9],
            description: '5=scheduled, 6=recurring no fixed time, 9=recurring with fixed time.',
          },
          start_time: { type: 'string' },
          duration: { type: 'integer' },
          timezone: { type: 'string' },
          password: { type: 'string' },
          agenda: { type: 'string' },
          settings: { type: 'object' },
          recurrence: { type: 'object' },
        },
        required: ['userId', 'topic'],
      },
      request: {
        method: 'POST',
        path: '/v2/users/{userId}/webinars',
        body: {
          topic: '{topic}',
          type: '{type}',
          start_time: '{start_time}',
          duration: '{duration}',
          timezone: '{timezone}',
          password: '{password}',
          agenda: '{agenda}',
          settings: '{settings}',
          recurrence: '{recurrence}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['webinar:write:webinar'],
    },
    {
      name: 'recordings.list',
      class: 'read',
      description: 'List cloud recordings for a user.',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User id, email, or "me".' },
          from: { type: 'string', description: 'YYYY-MM-DD lower bound.' },
          to: { type: 'string', description: 'YYYY-MM-DD upper bound.' },
          page_size: { type: 'integer', minimum: 1, maximum: 300 },
          next_page_token: { type: 'string' },
          mc: { type: 'string' },
          trash: { type: 'boolean' },
          trash_type: { type: 'string', enum: ['meeting_recordings', 'recording_file'] },
        },
        required: ['userId'],
      },
      request: {
        method: 'GET',
        path: '/v2/users/{userId}/recordings',
        query: {
          from: '{from}',
          to: '{to}',
          page_size: '{page_size}',
          next_page_token: '{next_page_token}',
          mc: '{mc}',
          trash: '{trash}',
          trash_type: '{trash_type}',
        },
      },
      requiredScopes: ['recording:read:recording'],
    },
    {
      name: 'recordings.get',
      class: 'read',
      description: 'List recording files for a meeting or recording id (use a double-encoded UUID if it begins with "/" or contains "//").',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'Meeting id or recording UUID.' },
          include_fields: { type: 'string', description: 'Comma-separated extra fields to include (e.g. download_access_token).' },
          ttl: { type: 'integer', description: 'TTL in seconds for download_access_token (max 604800).' },
        },
        required: ['meetingId'],
      },
      request: {
        method: 'GET',
        path: '/v2/meetings/{meetingId}/recordings',
        query: {
          include_fields: '{include_fields}',
          ttl: '{ttl}',
        },
      },
      requiredScopes: ['recording:read:recording'],
    },
  ],
})
