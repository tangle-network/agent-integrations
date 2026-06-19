import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Outreach (Outreach.io) sales-engagement API — JSON:API v2.
 *
 * Outreach uses a standard 3-legged OAuth2 authorization_code flow
 * (authorize at api.outreach.io/oauth/authorize, token at
 * api.outreach.io/oauth/token). Scopes follow a `{resource}.{permission}`
 * shape and are NOT additive — we request the read+write scopes that back
 * the capabilities below and nothing else (least privilege).
 *
 * The REST surface is JSON:API: requests and responses use the
 * `application/vnd.api+json` media type and the resource envelope
 * `{ data: { type, id?, attributes, relationships } }`. Mutations take a
 * structured `attributes` object (and, where relevant, a `relationships`
 * object) rather than flattening every field into a top-level argument —
 * this mirrors how the Salesforce adapter passes `fields` and keeps the
 * JSON:API envelope construction here in the manifest instead of leaking
 * it to the agent.
 */
export const outreachConnector = declarativeRestConnector({
  kind: 'outreach',
  displayName: 'Outreach',
  description:
    'Manage Outreach prospects, accounts, and opportunities, and enroll prospects into sequences, through the JSON:API v2 REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.outreach.io/oauth/authorize',
    tokenUrl: 'https://api.outreach.io/oauth/token',
    scopes: [
      'prospects.read',
      'prospects.write',
      'accounts.read',
      'accounts.write',
      'opportunities.read',
      'sequences.read',
      'sequenceStates.read',
      'sequenceStates.write',
      'users.read',
    ],
    clientIdEnv: 'OUTREACH_OAUTH_CLIENT_ID',
    clientSecretEnv: 'OUTREACH_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.outreach.io/api/v2',
  // Outreach is JSON:API — both the request and response media type is
  // application/vnd.api+json. The declarative runtime only forces a body
  // content-type when one isn't already present, so pinning it here makes
  // every write carry the JSON:API media type.
  defaultHeaders: {
    accept: 'application/vnd.api+json',
    'content-type': 'application/vnd.api+json',
  },
  test: { method: 'GET', path: '/users', query: { 'page[size]': '1' } },
  capabilities: [
    {
      name: 'prospects.list',
      class: 'read',
      description:
        'List or search prospects (contacts). Filter by email, paginate with pageSize/pageAfter, sort, and sideload related resources via include.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Filter prospects by email address (filter[emails][email]).' },
          pageSize: { type: 'number', description: 'Results per page (default 50, max 1000).' },
          pageAfter: { type: 'string', description: 'Cursor for the next page (cursor-based pagination).' },
          sort: { type: 'string', description: 'Attribute to sort by; prefix with - for descending (e.g. -createdAt).' },
          include: { type: 'string', description: 'Comma-separated related resources to sideload (e.g. account,owner).' },
        },
      },
      request: {
        method: 'GET',
        path: '/prospects',
        query: {
          'filter[emails][email]': '{email}',
          'page[size]': '{pageSize}',
          'page[after]': '{pageAfter}',
          sort: '{sort}',
          include: '{include}',
        },
      },
      requiredScopes: ['prospects.read'],
    },
    {
      name: 'prospects.create',
      class: 'mutation',
      description:
        'Create a prospect. Pass JSON:API `attributes` (e.g. { firstName, lastName, emails: [{ email, emailType: "work" }], title }) and an optional `relationships` object (e.g. { account: { data: { type: "account", id: 123 } } }).',
      parameters: {
        type: 'object',
        properties: {
          attributes: {
            type: 'object',
            description: 'JSON:API attributes for the prospect resource.',
            additionalProperties: true,
          },
          relationships: {
            type: 'object',
            description: 'Optional JSON:API relationships object linking the prospect to an account, owner, etc.',
            additionalProperties: true,
          },
        },
        required: ['attributes'],
      },
      request: {
        method: 'POST',
        path: '/prospects',
        body: { data: { type: 'prospect', attributes: '{attributes}', relationships: '{relationships}' } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['prospects.write'],
    },
    {
      name: 'prospects.update',
      class: 'mutation',
      description: 'Update a prospect by id. Pass the numeric id and a JSON:API `attributes` object; only provided fields change.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Numeric prospect id.' },
          attributes: { type: 'object', description: 'JSON:API attributes to update.', additionalProperties: true },
          relationships: { type: 'object', description: 'Optional JSON:API relationships to update.', additionalProperties: true },
        },
        required: ['id', 'attributes'],
      },
      request: {
        method: 'PATCH',
        path: '/prospects/{id}',
        body: { data: { type: 'prospect', id: '{id}', attributes: '{attributes}', relationships: '{relationships}' } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['prospects.write'],
    },
    {
      name: 'sequenceStates.create',
      class: 'mutation',
      description: 'Enroll a prospect into a sequence (start a sequence state). Provide the numeric prospectId and sequenceId.',
      parameters: {
        type: 'object',
        properties: {
          prospectId: { type: 'number', description: 'Numeric prospect id to enroll.' },
          sequenceId: { type: 'number', description: 'Numeric sequence id to enroll the prospect into.' },
        },
        required: ['prospectId', 'sequenceId'],
      },
      request: {
        method: 'POST',
        path: '/sequenceStates',
        body: {
          data: {
            type: 'sequenceState',
            relationships: {
              prospect: { data: { type: 'prospect', id: '{prospectId}' } },
              sequence: { data: { type: 'sequence', id: '{sequenceId}' } },
            },
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['sequenceStates.write'],
    },
    {
      name: 'opportunities.list',
      class: 'read',
      description: 'List opportunities, optionally filtered by account id; paginate and sideload via include.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'number', description: 'Filter opportunities by associated account id (filter[account][id]).' },
          pageSize: { type: 'number', description: 'Results per page.' },
          pageAfter: { type: 'string', description: 'Cursor for the next page.' },
          include: { type: 'string', description: 'Comma-separated related resources to sideload (e.g. account,prospects).' },
        },
      },
      request: {
        method: 'GET',
        path: '/opportunities',
        query: {
          'filter[account][id]': '{accountId}',
          'page[size]': '{pageSize}',
          'page[after]': '{pageAfter}',
          include: '{include}',
        },
      },
      requiredScopes: ['opportunities.read'],
    },
    {
      name: 'accounts.create',
      class: 'mutation',
      description: 'Create an account (company). Pass JSON:API `attributes` (name is required; domain and industry optional).',
      parameters: {
        type: 'object',
        properties: {
          attributes: {
            type: 'object',
            description: 'JSON:API attributes for the account resource, e.g. { name, domain, industry }.',
            additionalProperties: true,
          },
        },
        required: ['attributes'],
      },
      request: {
        method: 'POST',
        path: '/accounts',
        body: { data: { type: 'account', attributes: '{attributes}' } },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['accounts.write'],
    },
  ],
})
