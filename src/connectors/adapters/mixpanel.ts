import { declarativeRestConnector } from './declarative-rest.js'

// Mixpanel exposes two distinct REST surfaces that share Project credentials but
// live on different hosts:
//
//   - Ingestion API (api.mixpanel.com) — accepts event writes via /track and
//     profile writes via /engage. Authentication is the Project Token embedded
//     in the event payload; the HTTP request itself is unauthenticated. Mixpanel
//     EU customers must use api-eu.mixpanel.com (selected by the host operator
//     via the API_HOST connection metadata, falling back to the US host).
//
//   - Query API (mixpanel.com/api/2.0) — read-side endpoints (events export,
//     segmentation, funnels, profile lookup) authenticated with the Project's
//     Service Account credentials sent as HTTP Basic. Mixpanel does not issue
//     OAuth client credentials for these endpoints; an api-key shape is the
//     correct manifest declaration and the catalog reflects this.
//
// The catalog only enumerates the single mutation `trackEvent` (action id
// `track.event`). We model that as the sole `events.track` mutation so the
// `manifest.capabilities` map stays a faithful projection of the upstream
// activepieces piece, and we add the matching read endpoints from the public
// Mixpanel Query API so agents can close the loop (track → segment → inspect)
// without leaving the connector.

export const mixpanelConnector = declarativeRestConnector({
  kind: 'mixpanel',
  displayName: 'Mixpanel',
  description:
    'Send product analytics events to Mixpanel and query stored event / profile data via the Service Account Query API.',
  auth: {
    kind: 'api-key',
    hint: 'Mixpanel Project Token (for /track ingestion) plus Service Account username:secret (for the Query API). Configure API_HOST=api-eu.mixpanel.com for EU residency projects.',
  },
  category: 'database',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiHost', fallback: 'https://api.mixpanel.com' },
  test: { method: 'GET', path: '/' },
  capabilities: [
    {
      name: 'events.track',
      class: 'mutation',
      description:
        'Send a single product event to Mixpanel /track. The Project Token, event name, distinct_id, and event properties are required by Mixpanel ingestion semantics.',
      parameters: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            description: 'Event name (e.g. "Signup", "Purchase Completed").',
          },
          distinct_id: {
            type: 'string',
            description:
              'Stable identifier for the actor performing the event. Matches the Mixpanel profile distinct_id when profiles are also being written.',
          },
          event_properties: {
            type: 'object',
            description:
              'Extra event properties. Mixpanel reserved properties (token, time, $insert_id) are merged in by the adapter.',
            additionalProperties: true,
          },
          time: {
            type: 'integer',
            description:
              'Event timestamp in epoch seconds. Mixpanel rejects events older than 5 days for free projects.',
          },
          insert_id: {
            type: 'string',
            description:
              'Idempotency key for the event. Mixpanel deduplicates events with the same $insert_id within a 7-day window.',
          },
        },
        required: ['event', 'distinct_id'],
      },
      request: {
        method: 'POST',
        path: '/track',
        body: {
          event: '{event}',
          properties: {
            distinct_id: '{distinct_id}',
            $insert_id: '{insert_id}',
            time: '{time}',
            properties: '{event_properties}',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'profiles.set',
      class: 'mutation',
      description:
        'Set / overwrite properties on a Mixpanel user profile via /engage with the $set operation.',
      parameters: {
        type: 'object',
        properties: {
          distinct_id: { type: 'string' },
          properties: {
            type: 'object',
            description: 'Profile properties to set.',
            additionalProperties: true,
          },
        },
        required: ['distinct_id', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/engage',
        body: {
          $distinct_id: '{distinct_id}',
          $set: '{properties}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'events.export',
      class: 'read',
      description:
        'Stream raw events from the Mixpanel Export API for a project + date range. Uses Service Account credentials via HTTP Basic over the Query API host.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Mixpanel Project ID.' },
          from_date: { type: 'string', description: 'Inclusive UTC start date (YYYY-MM-DD).' },
          to_date: { type: 'string', description: 'Inclusive UTC end date (YYYY-MM-DD).' },
          event: {
            type: 'array',
            description: 'Optional list of event names to filter to.',
            items: { type: 'string' },
          },
          where: {
            type: 'string',
            description: 'Optional Mixpanel JQL-style filter expression.',
          },
        },
        required: ['project_id', 'from_date', 'to_date'],
      },
      request: {
        method: 'GET',
        path: 'https://data.mixpanel.com/api/2.0/export',
        query: {
          project_id: '{project_id}',
          from_date: '{from_date}',
          to_date: '{to_date}',
          event: '{event}',
          where: '{where}',
        },
      },
    },
    {
      name: 'events.segmentation',
      class: 'read',
      description:
        'Aggregate counts / uniques for a single event over a date range. Returns a Mixpanel segmentation report.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          event: { type: 'string' },
          from_date: { type: 'string' },
          to_date: { type: 'string' },
          unit: {
            type: 'string',
            description: 'Granularity bucket size.',
            enum: ['minute', 'hour', 'day', 'week', 'month'],
          },
          type: {
            type: 'string',
            description: 'Aggregation type.',
            enum: ['general', 'unique', 'average'],
          },
          on: {
            type: 'string',
            description: 'Property expression to segment on (e.g. "properties[\\"plan\\"]").',
          },
        },
        required: ['project_id', 'event', 'from_date', 'to_date'],
      },
      request: {
        method: 'GET',
        path: 'https://mixpanel.com/api/2.0/segmentation',
        query: {
          project_id: '{project_id}',
          event: '{event}',
          from_date: '{from_date}',
          to_date: '{to_date}',
          unit: '{unit}',
          type: '{type}',
          on: '{on}',
        },
      },
    },
    {
      name: 'profiles.query',
      class: 'read',
      description:
        'Query Mixpanel user profiles (Engage API) by selector / distinct_id. Returns a paginated list of profile documents.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          distinct_id: { type: 'string', description: 'Optional exact distinct_id lookup.' },
          selector: {
            type: 'string',
            description: 'Optional Mixpanel selector expression to filter profiles.',
          },
          page: { type: 'integer', description: 'Zero-based page index when paginating.' },
          session_id: {
            type: 'string',
            description:
              'Engage pagination session id returned by the previous page. Required for page > 0.',
          },
        },
        required: ['project_id'],
      },
      request: {
        method: 'GET',
        path: 'https://mixpanel.com/api/2.0/engage',
        query: {
          project_id: '{project_id}',
          distinct_id: '{distinct_id}',
          selector: '{selector}',
          page: '{page}',
          session_id: '{session_id}',
        },
      },
    },
  ],
})
