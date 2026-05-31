import { declarativeRestConnector } from './declarative-rest.js'

// Zapier exposes two trigger surfaces:
//   1. "Catch Hook" webhook URLs (per-Zap, copy-pasted from the Zap editor) —
//      the customer pastes the URL once; the executor POSTs JSON payloads to
//      that URL and the Zap fires on each delivery.
//   2. The REST Hooks API at https://api.zapier.com/v1 for programmatic Zap
//      management. This adapter wraps the hook-trigger surface — the most
//      common automation pattern. baseUrl is per-connection (the customer's
//      hooks.zapier.com URL host) and the path is the per-Zap hook id.
//
// Auth: the catch-hook surface is unauthenticated by URL secrecy; the API
// surface uses an account-scoped bearer token from the Zapier Developer
// portal. We model the bearer-token surface — call sites that only need the
// catch-hook can pass an empty token and use the `triggers.catch` action's
// fully-qualified URL directly.

export const zapierConnector = declarativeRestConnector({
  kind: 'zapier',
  displayName: 'Zapier',
  description:
    'Trigger Zapier Zaps from agents — POST payloads to per-Zap catch hooks and manage Zaps via the Zapier REST Hooks API.',
  auth: {
    kind: 'api-key',
    hint: 'Zapier API key (Bearer token) from https://zapier.com/app/developer. Used as `Authorization: Bearer <key>`. Not required for unauthenticated catch-hook POSTs — those use the per-Zap hook URL.',
  },
  category: 'other',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://hooks.zapier.com',
  capabilities: [
    {
      name: 'triggers.catch',
      class: 'mutation',
      description:
        'POST a JSON payload to a Zapier Catch Hook URL. `hookPath` is the path portion of the per-Zap hook URL (e.g. `/hooks/catch/123456/abc/`). The Zap that owns the hook receives the body and runs its downstream steps.',
      parameters: {
        type: 'object',
        properties: {
          hookPath: {
            type: 'string',
            description: 'Path portion of the Zapier catch-hook URL.',
          },
          payload: {
            type: 'object',
            description: 'Arbitrary JSON delivered to the Zap as the trigger event.',
          },
        },
        required: ['hookPath', 'payload'],
      },
      request: {
        method: 'POST',
        path: '{hookPath}',
        body: '{payload}',
      },
    },
    {
      name: 'zaps.list',
      class: 'read',
      description:
        'List Zaps owned by the authenticated account via the Zapier REST Hooks API (https://api.zapier.com/v1/zaps).',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['on', 'off'],
            description: 'Filter to Zaps in this state.',
          },
        },
      },
      request: {
        method: 'GET',
        path: 'https://api.zapier.com/v1/zaps',
        query: { status: '{status}' },
      },
    },
    {
      name: 'zaps.get',
      class: 'read',
      description: 'Read a single Zap by id from the Zapier REST Hooks API.',
      parameters: {
        type: 'object',
        properties: { zapId: { type: 'string' } },
        required: ['zapId'],
      },
      request: {
        method: 'GET',
        path: 'https://api.zapier.com/v1/zaps/{zapId}',
      },
    },
  ],
})
