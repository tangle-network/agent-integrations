import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Mailchimp Marketing API v3.0 — audience/list management, member upsert,
 * campaign send. Auth is OAuth2 with a per-account datacenter prefix; after
 * the token exchange callers MUST hit `https://login.mailchimp.com/oauth2/metadata`
 * with the access token and persist `api_endpoint` (e.g. `https://us20.api.mailchimp.com`)
 * into the data source `metadata.apiEndpoint` field. The declarative REST
 * runtime then routes every request against that per-tenant base URL.
 *
 * Mailchimp OAuth2 does not use scopes — the grant is account-wide and the
 * `scopes` array stays empty by design. We surface that explicitly in the
 * manifest so the UI does not collect a value that the upstream will ignore.
 *
 * Member upserts use PUT against `/lists/{listId}/members/{subscriberHash}`
 * where `subscriberHash` is the MD5 of the lowercase email — the caller is
 * expected to pre-compute it and pass it in. That keeps this adapter pure
 * declarative-REST and avoids smuggling crypto into the request layer.
 */
export const mailchimpConnector = declarativeRestConnector({
  kind: 'mailchimp',
  displayName: 'Mailchimp',
  description: 'Manage Mailchimp audiences, contacts, and campaigns through the Marketing API v3.0.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://login.mailchimp.com/oauth2/authorize',
    tokenUrl: 'https://login.mailchimp.com/oauth2/token',
    scopes: [],
    clientIdEnv: 'MAILCHIMP_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MAILCHIMP_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'apiEndpoint' },
  test: { method: 'GET', path: '/3.0/ping' },
  capabilities: [
    {
      name: 'lists.list',
      class: 'read',
      description: 'List Mailchimp audiences (lists) the connected account can access.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Page size; defaults to 10, max 1000.' },
          offset: { type: 'number', description: 'Number of records to skip.' },
        },
      },
      request: {
        method: 'GET',
        path: '/3.0/lists',
        query: { count: '{count}', offset: '{offset}' },
      },
    },
    {
      name: 'lists.get',
      class: 'read',
      description: 'Read a single Mailchimp audience by list id.',
      parameters: {
        type: 'object',
        properties: { listId: { type: 'string' } },
        required: ['listId'],
      },
      request: { method: 'GET', path: '/3.0/lists/{listId}' },
    },
    {
      name: 'members.search',
      class: 'read',
      description: 'List members of a Mailchimp audience.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          count: { type: 'number' },
          offset: { type: 'number' },
          status: {
            type: 'string',
            description: 'Filter by subscriber status (subscribed, unsubscribed, cleaned, pending, transactional).',
          },
        },
        required: ['listId'],
      },
      request: {
        method: 'GET',
        path: '/3.0/lists/{listId}/members',
        query: { count: '{count}', offset: '{offset}', status: '{status}' },
      },
    },
    {
      name: 'members.get',
      class: 'read',
      description: 'Read a Mailchimp audience member by subscriber hash (MD5 of the lowercased email).',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          subscriberHash: { type: 'string' },
        },
        required: ['listId', 'subscriberHash'],
      },
      request: { method: 'GET', path: '/3.0/lists/{listId}/members/{subscriberHash}' },
    },
    {
      name: 'members.upsert',
      class: 'mutation',
      description: 'Idempotent upsert of a Mailchimp audience member; PUT against the subscriber hash creates or updates.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          subscriberHash: { type: 'string', description: 'MD5 hex digest of the lowercased email address.' },
          fields: {
            type: 'object',
            description: 'Mailchimp member body; typically includes email_address, status_if_new, merge_fields, tags.',
          },
        },
        required: ['listId', 'subscriberHash', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/3.0/lists/{listId}/members/{subscriberHash}',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'members.update-tags',
      class: 'mutation',
      description: 'Add or remove tags on a Mailchimp audience member.',
      parameters: {
        type: 'object',
        properties: {
          listId: { type: 'string' },
          subscriberHash: { type: 'string' },
          fields: {
            type: 'object',
            description: 'Body shaped as `{ tags: [{ name, status: "active"|"inactive" }] }`.',
          },
        },
        required: ['listId', 'subscriberHash', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/3.0/lists/{listId}/members/{subscriberHash}/tags',
        body: '{fields}',
      },
      cas: 'native-idempotency',
    },
    {
      name: 'campaigns.list',
      class: 'read',
      description: 'List Mailchimp campaigns.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          offset: { type: 'number' },
          status: { type: 'string', description: 'save, paused, schedule, sending, sent.' },
        },
      },
      request: {
        method: 'GET',
        path: '/3.0/campaigns',
        query: { count: '{count}', offset: '{offset}', status: '{status}' },
      },
    },
    {
      name: 'campaigns.send',
      class: 'mutation',
      description: 'Send a Mailchimp campaign immediately (campaign must already be configured).',
      parameters: {
        type: 'object',
        properties: { campaignId: { type: 'string' } },
        required: ['campaignId'],
      },
      request: { method: 'POST', path: '/3.0/campaigns/{campaignId}/actions/send' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
