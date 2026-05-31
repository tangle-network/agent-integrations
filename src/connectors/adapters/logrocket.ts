import { declarativeRestConnector } from './declarative-rest.js'

/**
 * LogRocket (https://logrocket.com) is a session-replay + product-analytics
 * platform whose AI Highlights API surfaces summaries of user sessions. The
 * public REST surface is rooted at `/v1` and authenticated with a personal
 * API key presented as `Authorization: Bearer <key>` — the same shape the
 * Activepieces piece-logrocket connector uses.
 *
 * The Activepieces piece exposes two actions and one webhook trigger:
 *   - requestHighlights  → highlights.request   (mutation; async, results
 *                                                 are delivered to a webhook
 *                                                 URL the caller controls)
 *   - identifyUser       → users.identify       (mutation; user-trait upsert)
 *   - highlightsReady    → highlights.ready     (webhook; modelled as a
 *                                                 read of the latest request
 *                                                 so callers without an
 *                                                 inbound webhook can poll)
 *
 * The `users.identify` trait write is an unconditional upsert keyed on
 * `userId`, so it tolerates idempotent replay natively. The highlights
 * request returns a server-assigned `requestId` and accepts an
 * `idempotencyKey` we forward through the declarative-REST adapter — also
 * native-idempotency.
 */
export const logrocketConnector = declarativeRestConnector({
  kind: 'logrocket',
  displayName: 'LogRocket',
  description:
    'Request AI-generated session highlights and identify users in LogRocket.',
  auth: {
    kind: 'api-key',
    hint: 'LogRocket API key (Settings → Project Setup → API Keys).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.logrocket.com/v1',
  test: { method: 'GET', path: '/orgs' },
  capabilities: [
    {
      name: 'highlights.request',
      class: 'mutation',
      description:
        'Request AI-generated highlights for a project; results are POSTed to webhookUrl when ready.',
      parameters: {
        type: 'object',
        properties: {
          orgId: {
            type: 'string',
            description: 'LogRocket organization ID (slug or numeric ID).',
          },
          appId: {
            type: 'string',
            description:
              'LogRocket app/project ID. Either appId or projectId is required.',
          },
          projectId: {
            type: 'string',
            description:
              'LogRocket project ID (alias of appId for newer projects).',
          },
          webhookUrl: {
            type: 'string',
            description:
              'URL the highlights service will POST results to when the request completes.',
          },
          userEmail: {
            type: 'string',
            description: 'Filter sessions to a single user by email.',
          },
          timeRangeStart: {
            type: 'integer',
            description: 'Unix milliseconds — inclusive lower bound on session start.',
          },
          timeRangeEnd: {
            type: 'integer',
            description: 'Unix milliseconds — exclusive upper bound on session start.',
          },
          markdown: {
            type: 'boolean',
            description: 'Render highlights as markdown rather than plain text.',
          },
        },
        required: ['orgId', 'webhookUrl'],
      },
      request: {
        method: 'POST',
        path: '/orgs/{orgId}/apps/{appId}/highlights/requests',
        body: {
          projectId: '{projectId}',
          webhookUrl: '{webhookUrl}',
          userEmail: '{userEmail}',
          timeRangeStart: '{timeRangeStart}',
          timeRangeEnd: '{timeRangeEnd}',
          markdown: '{markdown}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'users.identify',
      class: 'mutation',
      description:
        'Identify a user / upsert trait metadata against an existing LogRocket app.',
      parameters: {
        type: 'object',
        properties: {
          orgId: {
            type: 'string',
            description: 'LogRocket organization ID.',
          },
          appId: {
            type: 'string',
            description: 'LogRocket app/project ID.',
          },
          userId: {
            type: 'string',
            description: 'Unique identifier for the user being identified.',
          },
          name: {
            type: 'string',
            description: 'Display name to attach to the user.',
          },
          email: {
            type: 'string',
            description: 'Email address to attach to the user.',
          },
          timestamp: {
            type: 'integer',
            description:
              'Unix milliseconds — when these traits were observed. Defaults to server time.',
          },
          traits: {
            type: 'object',
            description: 'Arbitrary key/value pairs to merge into the user profile.',
          },
        },
        required: ['orgId', 'appId', 'userId'],
      },
      request: {
        method: 'POST',
        path: '/orgs/{orgId}/apps/{appId}/identify',
        body: {
          userId: '{userId}',
          name: '{name}',
          email: '{email}',
          timestamp: '{timestamp}',
          traits: '{traits}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'highlights.ready',
      class: 'read',
      description:
        'Read the latest highlights request for a project — exposes the same payload the highlightsReady webhook would deliver, so callers without an inbound webhook can poll.',
      parameters: {
        type: 'object',
        properties: {
          orgId: {
            type: 'string',
            description: 'LogRocket organization ID.',
          },
          appId: {
            type: 'string',
            description: 'LogRocket app/project ID.',
          },
          requestId: {
            type: 'string',
            description:
              'Highlights request ID returned by highlights.request. Omit to fetch the most recent.',
          },
          status: {
            type: 'string',
            description:
              'Filter by request status (pending, complete, failed) when listing.',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of requests to return when listing.',
          },
        },
        required: ['orgId', 'appId'],
      },
      request: {
        method: 'GET',
        path: '/orgs/{orgId}/apps/{appId}/highlights/requests/{requestId}',
        query: { status: '{status}', limit: '{limit}' },
      },
    },
  ],
})
