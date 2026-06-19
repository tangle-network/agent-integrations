import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Gong revenue / conversation-intelligence API — v2.
 *
 * Gong OAuth apps use a 3-legged authorization_code flow: authorize at
 * app.gong.io/oauth2/authorize, exchange/refresh at
 * app.gong.io/oauth2/generate-customer-token. The token response carries an
 * `api_base_url_for_customer` (e.g. https://company-17.api.gong.io) that ALL
 * subsequent API calls must target — the generic api.gong.io host is only
 * valid for the legacy access-key (Basic) auth, NOT for OAuth apps. The hub
 * connect flow MUST persist that per-customer host (returned at token
 * exchange) into `metadata.apiBaseUrlForCustomer`; we resolve `baseUrl`
 * strictly from it with NO fallback. If the metadata is absent every call
 * fails loud (`missing metadata.apiBaseUrlForCustomer base URL`) rather than
 * silently routing to the OAuth-invalid generic host and looking active while
 * every request fails. Because the resolved base is a bare host (no version),
 * each capability path carries its own `/v2` prefix.
 *
 * Scopes are selected when registering the OAuth app in Gong's admin center
 * and echoed back on the token; we request the read+create scopes that back
 * the capabilities here.
 */
export const gongConnector = declarativeRestConnector({
  kind: 'gong',
  displayName: 'Gong',
  description:
    'Read Gong calls, transcripts, and users, ingest external calls, and assign prospects to Engage flows through the v2 API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://app.gong.io/oauth2/authorize',
    tokenUrl: 'https://app.gong.io/oauth2/generate-customer-token',
    scopes: [
      'api:calls:read:basic',
      'api:calls:read:extensive',
      'api:calls:read:transcript',
      'api:calls:create',
      'api:users:read',
      'api:flows:write',
    ],
    clientIdEnv: 'GONG_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GONG_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiBaseUrlForCustomer' },
  test: { method: 'GET', path: '/v2/users' },
  capabilities: [
    {
      name: 'calls.list',
      class: 'read',
      description: 'List calls in a time window. fromDateTime is required (ISO-8601); paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          fromDateTime: { type: 'string', description: 'ISO-8601 start datetime for calls to retrieve.' },
          toDateTime: { type: 'string', description: 'ISO-8601 end datetime for calls to retrieve.' },
          workspaceId: { type: 'string', description: 'Filter calls by a specific workspace id.' },
          cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
        },
        required: ['fromDateTime'],
      },
      request: {
        method: 'GET',
        path: '/v2/calls',
        query: { fromDateTime: '{fromDateTime}', toDateTime: '{toDateTime}', workspaceId: '{workspaceId}', cursor: '{cursor}' },
      },
      requiredScopes: ['api:calls:read:basic'],
    },
    {
      name: 'calls.getTranscripts',
      class: 'read',
      description:
        'Retrieve call transcripts. Pass a `filter` object (fromDateTime/toDateTime and/or callIds); paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            description: 'Filter object, e.g. { fromDateTime, toDateTime, callIds: ["..."] }.',
            additionalProperties: true,
          },
          cursor: { type: 'string', description: 'Pagination cursor for the next page.' },
        },
        required: ['filter'],
      },
      request: { method: 'POST', path: '/v2/calls/transcript', body: { filter: '{filter}', cursor: '{cursor}' } },
      requiredScopes: ['api:calls:read:transcript'],
    },
    {
      name: 'calls.getExtensive',
      class: 'read',
      description:
        'Retrieve extensive call data. Pass a `filter` object and an optional `contentSelector` controlling which enrichment fields/context to include.',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            description: 'Filter object: fromDateTime, toDateTime, callIds, primaryUserIds, or workspaceId.',
            additionalProperties: true,
          },
          contentSelector: {
            type: 'object',
            description: 'Controls included enrichment data (exposedFields, context objects).',
            additionalProperties: true,
          },
          cursor: { type: 'string', description: 'Pagination cursor from a prior response.' },
        },
        required: ['filter'],
      },
      request: {
        method: 'POST',
        path: '/v2/calls/extensive',
        body: { filter: '{filter}', contentSelector: '{contentSelector}', cursor: '{cursor}' },
      },
      requiredScopes: ['api:calls:read:extensive'],
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List Gong users (max 100 per page). Paginate with cursor.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string', description: 'Pagination cursor; omit for the first page.' },
          includeAvatars: { type: 'boolean', description: 'Include avatar image URLs in the response (default false).' },
        },
      },
      request: { method: 'GET', path: '/v2/users', query: { cursor: '{cursor}', includeAvatars: '{includeAvatars}' } },
      requiredScopes: ['api:users:read'],
    },
    {
      name: 'calls.create',
      class: 'mutation',
      description:
        'Ingest an external call into Gong. Required: clientUniqueId, actualStart (ISO-8601), direction (Inbound/Outbound/Conference/Unknown), parties (array of participant objects).',
      parameters: {
        type: 'object',
        properties: {
          clientUniqueId: { type: 'string', description: 'Unique identifier for the call in the source system.' },
          actualStart: { type: 'string', description: 'ISO-8601 datetime when the call started.' },
          direction: { type: 'string', enum: ['Inbound', 'Outbound', 'Conference', 'Unknown'], description: 'Call direction.' },
          title: { type: 'string', description: 'Title or subject of the call.' },
          parties: {
            type: 'array',
            description: 'Participant objects with emailAddress, name, phoneNumber, speakerId.',
            items: { type: 'object', additionalProperties: true },
          },
          mediaChannels: { type: 'object', description: 'Media channel configuration.', additionalProperties: true },
          workspaceId: { type: 'string', description: 'Workspace to associate the call with.' },
        },
        required: ['clientUniqueId', 'actualStart', 'direction', 'parties'],
      },
      request: { method: 'POST', path: '/v2/calls', body: 'args' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api:calls:create'],
    },
    {
      name: 'flows.assignProspects',
      class: 'mutation',
      description: 'Assign prospects to a Gong Engage flow. Provide flowId and a prospects array (up to 100).',
      parameters: {
        type: 'object',
        properties: {
          flowId: { type: 'string', description: 'Id of the Engage flow to assign prospects to.' },
          prospects: {
            type: 'array',
            description: 'Prospect objects (up to 100); each with crmProspectId and optional fields.',
            items: { type: 'object', additionalProperties: true },
          },
          actionSource: { type: 'string', description: 'Identifier of the integration making the assignment.' },
        },
        required: ['flowId', 'prospects'],
      },
      request: {
        method: 'POST',
        path: '/v2/flows/prospects/assign',
        body: { flowId: '{flowId}', prospects: '{prospects}', actionSource: '{actionSource}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['api:flows:write'],
    },
  ],
})
