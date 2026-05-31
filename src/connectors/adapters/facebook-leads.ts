import { declarativeRestConnector } from './declarative-rest.js'

// Facebook Leads exposes the Graph API surface for Lead Ads on pages the
// connected user manages. Each page owns a collection of `leadgen_forms`;
// each form accumulates `leads` (a "leadgen" record) as users submit the
// in-feed form. The activepieces catalog ships a single `new.lead` trigger
// (webhook-driven via the page subscription); the natural REST companion
// is the read surface that lets a planner enumerate forms, list leads on a
// form, fetch a single lead by id, and subscribe a page to the
// `leadgen` field so the platform's webhook receiver starts seeing events.
//
// Auth: OAuth2 user-grant. Page-scoped operations require a Page Access
// Token, obtained via /me/accounts on the connected user; the planner
// passes that token as `access_token` per call (so the bearer header is
// the user grant, and the page token is overlaid as a query argument
// where needed — mirrors how facebook-pages exposes /me/accounts).
//
// Consistency: leadgen is append-only and Graph exposes no If-Match path
// on form/subscription edits, so defaultConsistencyModel is 'advisory'.
// Subscription writes are idempotent on the (pageId, fields) pair so we
// mark them 'native-idempotency'.
export const facebookLeadsConnector = declarativeRestConnector({
  kind: 'facebook-leads',
  displayName: 'Facebook Leads',
  description:
    'Capture leads from Facebook Lead Ads: list lead-gen forms on managed pages, page through submitted leads, and subscribe a page to the leadgen webhook field.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopes: [
      'pages_show_list',
      'pages_manage_metadata',
      'leads_retrieval',
      'ads_management',
      'pages_read_engagement',
    ],
    clientIdEnv: 'FACEBOOK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_OAUTH_CLIENT_SECRET',
  },
  category: 'crm',
  defaultConsistencyModel: 'advisory',
  baseUrl: 'https://graph.facebook.com/v19.0',
  test: { method: 'GET', path: '/me' },
  capabilities: [
    {
      name: 'users.me',
      class: 'read',
      description:
        'Return the connected Facebook user (id, name) for the granted access token.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'string',
            description: 'Comma-separated Graph field selector (e.g. "id,name").',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/me',
        query: { fields: '{fields}' },
      },
      requiredScopes: ['pages_show_list'],
    },
    {
      name: 'pages.list',
      class: 'read',
      description:
        'List Facebook pages the connected user manages. Each entry includes a Page Access Token usable for page-scoped lead-gen actions.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'string',
            description:
              'Comma-separated Graph field selector. Default returns id,name,access_token,category,tasks.',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string', description: 'Cursor-style pagination token.' },
        },
      },
      request: {
        method: 'GET',
        path: '/me/accounts',
        query: { fields: '{fields}', limit: '{limit}', after: '{after}' },
      },
      requiredScopes: ['pages_show_list'],
    },
    {
      name: 'forms.list',
      class: 'read',
      description:
        'List lead-gen forms on a page. Requires a Page Access Token passed as access_token (in addition to the user grant bearer).',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the target page.',
          },
          fields: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string' },
        },
        required: ['pageId', 'access_token'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}/leadgen_forms',
        query: {
          access_token: '{access_token}',
          fields: '{fields}',
          limit: '{limit}',
          after: '{after}',
        },
      },
      requiredScopes: ['leads_retrieval', 'pages_show_list'],
    },
    {
      name: 'forms.get',
      class: 'read',
      description: 'Read a single lead-gen form by id.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the owning page.',
          },
          fields: { type: 'string' },
        },
        required: ['formId', 'access_token'],
      },
      request: {
        method: 'GET',
        path: '/{formId}',
        query: {
          access_token: '{access_token}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['leads_retrieval'],
    },
    {
      name: 'forms.leads.list',
      class: 'read',
      description:
        'List leads submitted against a form. Returns the field_data array per lead; use `filtering` for created_time windows.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the owning page.',
          },
          fields: { type: 'string' },
          filtering: {
            type: 'string',
            description:
              'JSON-encoded filter spec, e.g. [{"field":"time_created","operator":"GREATER_THAN","value":1700000000}].',
          },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          after: { type: 'string' },
        },
        required: ['formId', 'access_token'],
      },
      request: {
        method: 'GET',
        path: '/{formId}/leads',
        query: {
          access_token: '{access_token}',
          fields: '{fields}',
          filtering: '{filtering}',
          limit: '{limit}',
          after: '{after}',
        },
      },
      requiredScopes: ['leads_retrieval'],
    },
    {
      name: 'leads.get',
      class: 'read',
      description:
        'Read a single lead by leadgen id. The new.lead trigger emits a leadgen_id; this is the canonical hydrate path.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the owning page.',
          },
          fields: {
            type: 'string',
            description:
              'Comma-separated Graph field selector. Default returns created_time,id,ad_id,form_id,field_data.',
          },
        },
        required: ['leadId', 'access_token'],
      },
      request: {
        method: 'GET',
        path: '/{leadId}',
        query: {
          access_token: '{access_token}',
          fields: '{fields}',
        },
      },
      requiredScopes: ['leads_retrieval'],
    },
    {
      name: 'page.subscriptions.list',
      class: 'read',
      description:
        'List the webhook field subscriptions currently attached to a page. Used to confirm a page is subscribed to the leadgen field before relying on new.lead.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the target page.',
          },
        },
        required: ['pageId', 'access_token'],
      },
      request: {
        method: 'GET',
        path: '/{pageId}/subscribed_apps',
        query: { access_token: '{access_token}' },
      },
      requiredScopes: ['pages_manage_metadata'],
    },
    {
      name: 'page.subscriptions.create',
      class: 'mutation',
      description:
        'Subscribe a page to webhook fields (must include "leadgen" for the new.lead trigger). Idempotent on the (pageId, fields) pair.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the target page.',
          },
          subscribed_fields: {
            type: 'string',
            description: 'Comma-separated field list, e.g. "leadgen".',
          },
        },
        required: ['pageId', 'access_token', 'subscribed_fields'],
      },
      request: {
        method: 'POST',
        path: '/{pageId}/subscribed_apps',
        body: {
          access_token: '{access_token}',
          subscribed_fields: '{subscribed_fields}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['pages_manage_metadata'],
    },
    {
      name: 'page.subscriptions.delete',
      class: 'mutation',
      description:
        'Remove the app webhook subscription on a page. Idempotent on the page id.',
      parameters: {
        type: 'object',
        properties: {
          pageId: { type: 'string' },
          access_token: {
            type: 'string',
            description: 'Page Access Token for the target page.',
          },
        },
        required: ['pageId', 'access_token'],
      },
      request: {
        method: 'DELETE',
        path: '/{pageId}/subscribed_apps',
        query: { access_token: '{access_token}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['pages_manage_metadata'],
    },
  ],
})
