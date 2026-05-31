import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Typeform Create API — read forms + responses, mutate forms, register webhooks
 * for response.received fan-out. OAuth2 against api.typeform.com; scopes are
 * resource:read|write tuples plus the `offline` scope which Typeform requires
 * to mint a refresh token (omit it and the integration becomes a 4-hour token).
 *
 * Base URL is a single global host (no per-tenant routing). Responses live on
 * `/forms/{form_id}/responses` and are immutable from the API side; webhooks
 * are how customers tail new submissions in near-real-time without polling.
 */
export const typeformConnector = declarativeRestConnector({
  kind: 'typeform',
  displayName: 'Typeform',
  description: 'Read Typeform forms and responses, edit forms, and manage webhook subscriptions for response.received events.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.typeform.com/oauth/authorize',
    tokenUrl: 'https://api.typeform.com/oauth/token',
    // `offline` is required for refresh tokens; omitting it caps the grant at the access-token lifetime.
    scopes: ['forms:read', 'forms:write', 'responses:read', 'webhooks:read', 'webhooks:write', 'workspaces:read', 'accounts:read', 'offline'],
    clientIdEnv: 'TYPEFORM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TYPEFORM_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.typeform.com',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'account.get',
      class: 'read',
      description: 'Get the authenticated Typeform account.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/me' },
    },
    {
      name: 'forms.list',
      class: 'read',
      description: 'List forms in the connected workspace; supports pagination and search.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 200 },
          search: { type: 'string', description: 'Substring filter against form titles.' },
          workspace_id: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/forms',
        query: {
          page: '{page}',
          page_size: '{page_size}',
          search: '{search}',
          workspace_id: '{workspace_id}',
        },
      },
    },
    {
      name: 'forms.get',
      class: 'read',
      description: 'Read a single form definition by id.',
      parameters: {
        type: 'object',
        properties: { form_id: { type: 'string' } },
        required: ['form_id'],
      },
      request: { method: 'GET', path: '/forms/{form_id}' },
    },
    {
      name: 'responses.list',
      class: 'read',
      description: 'List responses to a form; supports cursor-style pagination via since/until/before/after and the answered-fields filter.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          page_size: { type: 'integer', minimum: 1, maximum: 1000 },
          since: { type: 'string', description: 'ISO-8601 lower bound (inclusive).' },
          until: { type: 'string', description: 'ISO-8601 upper bound (exclusive).' },
          before: { type: 'string', description: 'Response token cursor — return responses submitted before this token.' },
          after: { type: 'string', description: 'Response token cursor — return responses submitted after this token.' },
          included_response_ids: { type: 'string', description: 'Comma-separated response tokens to include.' },
          completed: { type: 'boolean' },
          sort: { type: 'string', description: 'e.g. "submitted_at,asc" or "submitted_at,desc".' },
          query: { type: 'string', description: 'Free-text search across response answers.' },
          fields: { type: 'string', description: 'Comma-separated answer field ids to include.' },
        },
        required: ['form_id'],
      },
      request: {
        method: 'GET',
        path: '/forms/{form_id}/responses',
        query: {
          page_size: '{page_size}',
          since: '{since}',
          until: '{until}',
          before: '{before}',
          after: '{after}',
          included_response_ids: '{included_response_ids}',
          completed: '{completed}',
          sort: '{sort}',
          query: '{query}',
          fields: '{fields}',
        },
      },
    },
    {
      name: 'responses.delete',
      class: 'mutation',
      description: 'Delete one or more responses by response token. Irreversible — the responses are removed from analytics and exports.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          included_tokens: { type: 'string', description: 'Comma-separated response tokens to delete.' },
        },
        required: ['form_id', 'included_tokens'],
      },
      request: {
        method: 'DELETE',
        path: '/forms/{form_id}/responses',
        query: { included_tokens: '{included_tokens}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'forms.update',
      class: 'mutation',
      description: 'Replace a Typeform form definition (PUT semantics — the body must be the complete form).',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          fields: { type: 'object', description: 'Complete form payload — title, fields[], welcome_screens, thankyou_screens, settings, theme, workspace, hidden, logic.' },
        },
        required: ['form_id', 'fields'],
      },
      request: {
        method: 'PUT',
        path: '/forms/{form_id}',
        body: '{fields}',
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'webhooks.list',
      class: 'read',
      description: 'List webhook subscriptions on a form.',
      parameters: {
        type: 'object',
        properties: { form_id: { type: 'string' } },
        required: ['form_id'],
      },
      request: { method: 'GET', path: '/forms/{form_id}/webhooks' },
    },
    {
      name: 'webhooks.get',
      class: 'read',
      description: 'Read a single webhook subscription by tag.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          tag: { type: 'string', description: 'Caller-chosen webhook identifier.' },
        },
        required: ['form_id', 'tag'],
      },
      request: { method: 'GET', path: '/forms/{form_id}/webhooks/{tag}' },
    },
    {
      name: 'webhooks.upsert',
      class: 'mutation',
      description: 'Create or update a webhook subscription on a form. PUT against the tag is idempotent — repeat calls with the same tag overwrite the prior subscription.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          tag: { type: 'string' },
          url: { type: 'string', description: 'HTTPS endpoint Typeform should POST submissions to.' },
          enabled: { type: 'boolean' },
          secret: { type: 'string', description: 'Shared secret used to sign payloads via Typeform-Signature header.' },
          verify_ssl: { type: 'boolean' },
        },
        required: ['form_id', 'tag', 'url'],
      },
      request: {
        method: 'PUT',
        path: '/forms/{form_id}/webhooks/{tag}',
        body: {
          url: '{url}',
          enabled: '{enabled}',
          secret: '{secret}',
          verify_ssl: '{verify_ssl}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Delete a webhook subscription by tag.',
      parameters: {
        type: 'object',
        properties: {
          form_id: { type: 'string' },
          tag: { type: 'string' },
        },
        required: ['form_id', 'tag'],
      },
      request: { method: 'DELETE', path: '/forms/{form_id}/webhooks/{tag}' },
      cas: 'native-idempotency',
    },
    {
      name: 'workspaces.list',
      class: 'read',
      description: 'List workspaces the connected account can access.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          page_size: { type: 'integer', minimum: 1, maximum: 200 },
          search: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/workspaces',
        query: { page: '{page}', page_size: '{page_size}', search: '{search}' },
      },
    },
  ],
})
