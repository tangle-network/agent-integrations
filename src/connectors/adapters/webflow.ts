/**
 * @stable Webflow CMS connector — read sites/collections/items and create or
 * update collection items through the Webflow Data API v2.
 *
 * Webflow's data model is three levels deep: sites → collections → items.
 * A single OAuth connection grants access to all authorized sites under the
 * connected workspace; capability calls take the relevant `siteId` or
 * `collectionId` as an explicit argument so one connection can drive many
 * sites without re-auth.
 *
 * Capabilities:
 *
 *   sites.list()
 *     → { sites: [...] }
 *     Read. GET /v2/sites.
 *
 *   sites.get(siteId)
 *     → site shape
 *     Read. GET /v2/sites/{siteId}.
 *
 *   collections.list(siteId)
 *     → { collections: [...] }
 *     Read. GET /v2/sites/{siteId}/collections.
 *
 *   collections.get(collectionId)
 *     → collection shape (includes field definitions)
 *     Read. GET /v2/collections/{collectionId}.
 *
 *   items.list(collectionId, offset?, limit?, name?, slug?)
 *     → { items: [...], pagination }
 *     Read. GET /v2/collections/{collectionId}/items.
 *
 *   items.get(collectionId, itemId)
 *     → CMS item shape
 *     Read. GET /v2/collections/{collectionId}/items/{itemId}.
 *
 *   items.create(collectionId, fieldData, isArchived?, isDraft?)
 *     → created item
 *     Mutation. POST /v2/collections/{collectionId}/items with the item
 *     wrapped under the `items` envelope.
 *
 *   items.update(collectionId, itemId, fieldData, isArchived?, isDraft?)
 *     → updated item
 *     Mutation. PATCH /v2/collections/{collectionId}/items/{itemId}.
 *
 *   items.delete(collectionId, itemId)
 *     → empty
 *     Mutation. DELETE /v2/collections/{collectionId}/items/{itemId}.
 *
 *   items.publish(collectionId, itemIds)
 *     → { publishedItemIds, errors }
 *     Mutation. POST /v2/collections/{collectionId}/items/publish to move
 *     staged items live to the published site.
 *
 *   pages.list(siteId)
 *     → { pages: [...], pagination }
 *     Read. GET /v2/sites/{siteId}/pages.
 *
 *   forms.list(siteId)
 *     → { forms: [...], pagination }
 *     Read. GET /v2/sites/{siteId}/forms.
 *
 *   forms.submissions(formId)
 *     → { formSubmissions: [...], pagination }
 *     Read. GET /v2/forms/{formId}/submissions.
 *
 * Auth: OAuth2 (Webflow OAuth app + Bearer token). Webflow scopes use the
 * `resource:action` shape (`sites:read`, `cms:write`, etc.); the connector
 * requests the union of read+write across the resources the capability set
 * touches.
 *
 * Versioning: Webflow does not emit HTTP ETag headers and does not implement
 * If-Match semantics on the v2 Data API. Mutations rely on the
 * `native-idempotency` model — the caller's idempotency key is forwarded by
 * the declarative-REST runtime so retries collapse server-side. Concurrent
 * field-data edits last-writer-wins; agents that need stronger ordering must
 * serialize at the application layer.
 */

import { declarativeRestConnector } from './declarative-rest.js'

const WEBFLOW_API_VERSION = '2.0.0'

export const webflowConnector = declarativeRestConnector({
  kind: 'webflow',
  displayName: 'Webflow',
  description:
    'Read Webflow sites, collections, pages, forms, and form submissions, and create, update, delete, or publish CMS items through the Webflow Data API v2.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://webflow.com/oauth/authorize',
    tokenUrl: 'https://api.webflow.com/oauth/access_token',
    scopes: [
      'sites:read',
      'cms:read',
      'cms:write',
      'pages:read',
      'forms:read',
    ],
    clientIdEnv: 'WEBFLOW_OAUTH_CLIENT_ID',
    clientSecretEnv: 'WEBFLOW_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.webflow.com',
  defaultHeaders: {
    'accept-version': WEBFLOW_API_VERSION,
    'content-type': 'application/json',
  },
  test: { method: 'GET', path: '/v2/token/authorized_by' },
  capabilities: [
    {
      name: 'sites.list',
      class: 'read',
      description: 'List Webflow sites the connected workspace can access.',
      parameters: {
        type: 'object',
        properties: {},
      },
      request: { method: 'GET', path: '/v2/sites' },
      requiredScopes: ['sites:read'],
    },
    {
      name: 'sites.get',
      class: 'read',
      description: 'Read a single Webflow site by ID.',
      parameters: {
        type: 'object',
        properties: { siteId: { type: 'string', description: 'Webflow site ID.' } },
        required: ['siteId'],
      },
      request: { method: 'GET', path: '/v2/sites/{siteId}' },
      requiredScopes: ['sites:read'],
    },
    {
      name: 'collections.list',
      class: 'read',
      description: 'List CMS collections defined on a Webflow site.',
      parameters: {
        type: 'object',
        properties: { siteId: { type: 'string' } },
        required: ['siteId'],
      },
      request: { method: 'GET', path: '/v2/sites/{siteId}/collections' },
      requiredScopes: ['cms:read'],
    },
    {
      name: 'collections.get',
      class: 'read',
      description: 'Fetch a Webflow CMS collection, including its field definitions.',
      parameters: {
        type: 'object',
        properties: { collectionId: { type: 'string' } },
        required: ['collectionId'],
      },
      request: { method: 'GET', path: '/v2/collections/{collectionId}' },
      requiredScopes: ['cms:read'],
    },
    {
      name: 'items.list',
      class: 'read',
      description: 'List items in a Webflow CMS collection. Pagination is offset-based; `name` and `slug` filter on those reserved fields.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          name: { type: 'string', description: 'Filter on the reserved `name` field (exact match).' },
          slug: { type: 'string', description: 'Filter on the reserved `slug` field (exact match).' },
        },
        required: ['collectionId'],
      },
      request: {
        method: 'GET',
        path: '/v2/collections/{collectionId}/items',
        query: {
          offset: '{offset}',
          limit: '{limit}',
          name: '{name}',
          slug: '{slug}',
        },
      },
      requiredScopes: ['cms:read'],
    },
    {
      name: 'items.get',
      class: 'read',
      description: 'Fetch a single Webflow CMS item by collection + item ID.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          itemId: { type: 'string' },
        },
        required: ['collectionId', 'itemId'],
      },
      request: { method: 'GET', path: '/v2/collections/{collectionId}/items/{itemId}' },
      requiredScopes: ['cms:read'],
    },
    {
      name: 'items.create',
      class: 'mutation',
      description:
        'Create a CMS item in a Webflow collection. `fieldData` carries the per-field values keyed by collection field slug; reserved fields like `name` and `slug` live alongside custom fields.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          fieldData: {
            type: 'object',
            description: 'Field-slug keyed values for the new item, e.g. `{ name: "Post", slug: "post" }`.',
            additionalProperties: true,
          },
          isArchived: { type: 'boolean', description: 'Create the item archived. Defaults to false.' },
          isDraft: { type: 'boolean', description: 'Create the item as draft (unpublished). Defaults to false.' },
        },
        required: ['collectionId', 'fieldData'],
      },
      request: {
        method: 'POST',
        path: '/v2/collections/{collectionId}/items',
        body: {
          fieldData: '{fieldData}',
          isArchived: '{isArchived}',
          isDraft: '{isDraft}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'items.update',
      class: 'mutation',
      description:
        'Update a CMS item in a Webflow collection. Webflow does not support optimistic concurrency on the Data API; concurrent edits last-writer-wins.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          itemId: { type: 'string' },
          fieldData: {
            type: 'object',
            description: 'Field-slug keyed values to overwrite on the item.',
            additionalProperties: true,
          },
          isArchived: { type: 'boolean' },
          isDraft: { type: 'boolean' },
        },
        required: ['collectionId', 'itemId', 'fieldData'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/collections/{collectionId}/items/{itemId}',
        body: {
          fieldData: '{fieldData}',
          isArchived: '{isArchived}',
          isDraft: '{isDraft}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'items.delete',
      class: 'mutation',
      description: 'Delete a CMS item from a Webflow collection.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          itemId: { type: 'string' },
        },
        required: ['collectionId', 'itemId'],
      },
      request: { method: 'DELETE', path: '/v2/collections/{collectionId}/items/{itemId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'items.publish',
      class: 'mutation',
      description:
        'Publish one or more staged CMS items live to the connected Webflow site. Items remain in their collection but become visible on the published site.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          itemIds: {
            type: 'array',
            description: 'Item IDs in the collection to publish.',
            items: { type: 'string' },
            minItems: 1,
          },
        },
        required: ['collectionId', 'itemIds'],
      },
      request: {
        method: 'POST',
        path: '/v2/collections/{collectionId}/items/publish',
        body: {
          itemIds: '{itemIds}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'items.unpublish',
      class: 'mutation',
      description:
        'Unpublish one or more CMS items from the live Webflow site. Items remain in their collection but are removed from the published view.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
          itemIds: {
            type: 'array',
            description: 'Item IDs in the collection to unpublish.',
            items: { type: 'string' },
            minItems: 1,
          },
        },
        required: ['collectionId', 'itemIds'],
      },
      request: {
        method: 'POST',
        path: '/v2/collections/{collectionId}/items/unpublish',
        body: {
          itemIds: '{itemIds}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'collections.create',
      class: 'mutation',
      description:
        'Create a CMS collection on a Webflow site. `displayName` is the human-readable label, `singularName` is the per-item noun, `slug` (optional) sets the URL/api slug.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'Webflow site ID that owns the new collection.' },
          displayName: { type: 'string', description: 'Display name of the collection.' },
          singularName: { type: 'string', description: 'Singular noun for an item in the collection.' },
          slug: { type: 'string', description: 'Optional collection slug — auto-generated from displayName if omitted.' },
        },
        required: ['siteId', 'displayName', 'singularName'],
      },
      request: {
        method: 'POST',
        path: '/v2/sites/{siteId}/collections',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'collections.delete',
      class: 'mutation',
      description: 'Delete a CMS collection from a Webflow site. All items in the collection are removed.',
      parameters: {
        type: 'object',
        properties: {
          collectionId: { type: 'string' },
        },
        required: ['collectionId'],
      },
      request: { method: 'DELETE', path: '/v2/collections/{collectionId}' },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['cms:write'],
    },
    {
      name: 'sites.publish',
      class: 'mutation',
      description:
        'Publish a Webflow site to its domains. `publishToWebflowSubdomain` toggles the *.webflow.io staging URL; `customDomains` is an array of domain IDs (from `sites.get`) to publish to. At least one target must be supplied.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          publishToWebflowSubdomain: {
            type: 'boolean',
            description: 'Publish to the *.webflow.io staging subdomain. Defaults to false.',
          },
          customDomains: {
            type: 'array',
            description: 'Custom domain IDs (see Site.customDomains[].id) to publish to.',
            items: { type: 'string' },
          },
        },
        required: ['siteId'],
      },
      request: {
        method: 'POST',
        path: '/v2/sites/{siteId}/publish',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['sites:read', 'cms:write'],
    },
    {
      name: 'pages.list',
      class: 'read',
      description: 'List static pages defined on a Webflow site.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['siteId'],
      },
      request: {
        method: 'GET',
        path: '/v2/sites/{siteId}/pages',
        query: {
          offset: '{offset}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['pages:read'],
    },
    {
      name: 'forms.list',
      class: 'read',
      description: 'List forms defined on a Webflow site.',
      parameters: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['siteId'],
      },
      request: {
        method: 'GET',
        path: '/v2/sites/{siteId}/forms',
        query: {
          offset: '{offset}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['forms:read'],
    },
    {
      name: 'forms.submissions',
      class: 'read',
      description: 'List form submissions for a Webflow form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          offset: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/v2/forms/{formId}/submissions',
        query: {
          offset: '{offset}',
          limit: '{limit}',
        },
      },
      requiredScopes: ['forms:read'],
    },
  ],
})
