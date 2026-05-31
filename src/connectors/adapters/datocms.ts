import { declarativeRestConnector } from './declarative-rest.js'

/**
 * DatoCMS Content Management API (https://www.datocms.com/docs/content-management-api).
 *
 * Auth: Bearer API token (project full-access or CMA token). The activepieces
 * catalog entry exposes an `apiKey` + optional `environment` (sandbox env name)
 * field; we model the bearer here and document the sandbox-environment header
 * on each capability that supports it. The CMA requires `X-Api-Version: 3` and
 * `Accept: application/json` on every request.
 *
 * The catalog `actions` array is empty (the activepieces piece is currently a
 * stub), so the capability surface below covers the documented CMA resources
 * we care about for an agent integration: items (records), item types
 * (models), uploads, environments, users, and webhooks. Reads use plural
 * `*.list` / singular `*.get`; mutations use REST verbs (POST/PUT/DELETE) on
 * the canonical CMA paths.
 */
export const datocmsConnector = declarativeRestConnector({
  kind: 'datocms',
  displayName: 'DatoCMS',
  description:
    'Read and mutate DatoCMS records (items), models (item types), uploads, environments, users, and webhooks via the Content Management API.',
  auth: {
    kind: 'api-key',
    hint: 'DatoCMS full-access API token (Settings → API tokens). Sent as a Bearer token; sandbox environment selection is forwarded via the X-Environment header on capabilities that accept an `environment` parameter.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://site-api.datocms.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: {
    Accept: 'application/json',
    'Content-Type': 'application/vnd.api+json',
    'X-Api-Version': '3',
  },
  test: { method: 'GET', path: '/site' },
  capabilities: [
    {
      name: 'site.get',
      class: 'read',
      description: 'Fetch the current DatoCMS project (site) metadata.',
      parameters: {
        type: 'object',
        properties: { environment: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/site',
        headers: { 'X-Environment': '{environment}' },
      },
    },
    {
      name: 'items.list',
      class: 'read',
      description: 'List records (items), optionally filtered by item type and paginated.',
      parameters: {
        type: 'object',
        properties: {
          itemTypeId: { type: 'string' },
          environment: { type: 'string' },
          locale: { type: 'string' },
          version: { type: 'string' },
          pageOffset: { type: 'integer' },
          pageLimit: { type: 'integer' },
        },
      },
      request: {
        method: 'GET',
        path: '/items',
        headers: { 'X-Environment': '{environment}' },
        query: {
          'filter[type]': '{itemTypeId}',
          locale: '{locale}',
          version: '{version}',
          'page[offset]': '{pageOffset}',
          'page[limit]': '{pageLimit}',
        },
      },
    },
    {
      name: 'items.get',
      class: 'read',
      description: 'Fetch a single record by id.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          environment: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['itemId'],
      },
      request: {
        method: 'GET',
        path: '/items/{itemId}',
        headers: { 'X-Environment': '{environment}' },
        query: { version: '{version}' },
      },
    },
    {
      name: 'items.create',
      class: 'mutation',
      description: 'Create a record (item) of a given item type.',
      parameters: {
        type: 'object',
        properties: {
          itemTypeId: { type: 'string' },
          attributes: { type: 'object' },
          environment: { type: 'string' },
        },
        required: ['itemTypeId', 'attributes'],
      },
      request: {
        method: 'POST',
        path: '/items',
        headers: { 'X-Environment': '{environment}' },
        body: {
          data: {
            type: 'item',
            attributes: '{attributes}',
            relationships: {
              item_type: { data: { type: 'item_type', id: '{itemTypeId}' } },
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'items.update',
      class: 'mutation',
      description: 'Update an existing record.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          attributes: { type: 'object' },
          environment: { type: 'string' },
        },
        required: ['itemId', 'attributes'],
      },
      request: {
        method: 'PUT',
        path: '/items/{itemId}',
        headers: { 'X-Environment': '{environment}' },
        body: {
          data: { type: 'item', id: '{itemId}', attributes: '{attributes}' },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'items.delete',
      class: 'mutation',
      description: 'Delete a record.',
      parameters: {
        type: 'object',
        properties: { itemId: { type: 'string' }, environment: { type: 'string' } },
        required: ['itemId'],
      },
      request: {
        method: 'DELETE',
        path: '/items/{itemId}',
        headers: { 'X-Environment': '{environment}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'items.publish',
      class: 'mutation',
      description: 'Publish a draft record.',
      parameters: {
        type: 'object',
        properties: { itemId: { type: 'string' }, environment: { type: 'string' } },
        required: ['itemId'],
      },
      request: {
        method: 'PUT',
        path: '/items/{itemId}/publish',
        headers: { 'X-Environment': '{environment}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'items.unpublish',
      class: 'mutation',
      description: 'Unpublish a published record.',
      parameters: {
        type: 'object',
        properties: { itemId: { type: 'string' }, environment: { type: 'string' } },
        required: ['itemId'],
      },
      request: {
        method: 'PUT',
        path: '/items/{itemId}/unpublish',
        headers: { 'X-Environment': '{environment}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'itemTypes.list',
      class: 'read',
      description: 'List item types (models) defined in the project.',
      parameters: {
        type: 'object',
        properties: { environment: { type: 'string' } },
      },
      request: {
        method: 'GET',
        path: '/item-types',
        headers: { 'X-Environment': '{environment}' },
      },
    },
    {
      name: 'itemTypes.get',
      class: 'read',
      description: 'Fetch a single item type (model) by id.',
      parameters: {
        type: 'object',
        properties: {
          itemTypeId: { type: 'string' },
          environment: { type: 'string' },
        },
        required: ['itemTypeId'],
      },
      request: {
        method: 'GET',
        path: '/item-types/{itemTypeId}',
        headers: { 'X-Environment': '{environment}' },
      },
    },
    {
      name: 'uploads.list',
      class: 'read',
      description: 'List media uploads.',
      parameters: {
        type: 'object',
        properties: {
          environment: { type: 'string' },
          pageOffset: { type: 'integer' },
          pageLimit: { type: 'integer' },
          query: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/uploads',
        headers: { 'X-Environment': '{environment}' },
        query: {
          'page[offset]': '{pageOffset}',
          'page[limit]': '{pageLimit}',
          'filter[query]': '{query}',
        },
      },
    },
    {
      name: 'uploads.get',
      class: 'read',
      description: 'Fetch a single upload by id.',
      parameters: {
        type: 'object',
        properties: {
          uploadId: { type: 'string' },
          environment: { type: 'string' },
        },
        required: ['uploadId'],
      },
      request: {
        method: 'GET',
        path: '/uploads/{uploadId}',
        headers: { 'X-Environment': '{environment}' },
      },
    },
    {
      name: 'uploads.create',
      class: 'mutation',
      description:
        'Register a previously uploaded S3 path as a DatoCMS upload (call /upload-requests first to obtain the path).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          author: { type: 'string' },
          copyright: { type: 'string' },
          notes: { type: 'string' },
          defaultFieldMetadata: { type: 'object' },
          environment: { type: 'string' },
        },
        required: ['path'],
      },
      request: {
        method: 'POST',
        path: '/uploads',
        headers: { 'X-Environment': '{environment}' },
        body: {
          data: {
            type: 'upload',
            attributes: {
              path: '{path}',
              author: '{author}',
              copyright: '{copyright}',
              notes: '{notes}',
              default_field_metadata: '{defaultFieldMetadata}',
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'uploads.requestUrl',
      class: 'mutation',
      description:
        'Request a signed S3 upload URL for a new media file. Returned URL is uploaded to with a separate PUT, then registered via uploads.create.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          environment: { type: 'string' },
        },
        required: ['filename'],
      },
      request: {
        method: 'POST',
        path: '/upload-requests',
        headers: { 'X-Environment': '{environment}' },
        body: {
          data: {
            type: 'upload_request',
            attributes: { filename: '{filename}' },
          },
        },
      },
      externalEffect: true,
    },
    {
      name: 'uploads.delete',
      class: 'mutation',
      description: 'Delete an upload.',
      parameters: {
        type: 'object',
        properties: {
          uploadId: { type: 'string' },
          environment: { type: 'string' },
        },
        required: ['uploadId'],
      },
      request: {
        method: 'DELETE',
        path: '/uploads/{uploadId}',
        headers: { 'X-Environment': '{environment}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'environments.list',
      class: 'read',
      description: 'List sandbox environments for the project.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/environments' },
    },
    {
      name: 'environments.get',
      class: 'read',
      description: 'Fetch a single environment by id.',
      parameters: {
        type: 'object',
        properties: { environmentId: { type: 'string' } },
        required: ['environmentId'],
      },
      request: { method: 'GET', path: '/environments/{environmentId}' },
    },
    {
      name: 'environments.fork',
      class: 'mutation',
      description: 'Fork an existing environment to create a new sandbox.',
      parameters: {
        type: 'object',
        properties: {
          sourceEnvironmentId: { type: 'string' },
          newEnvironmentId: { type: 'string' },
          fast: { type: 'boolean' },
        },
        required: ['sourceEnvironmentId', 'newEnvironmentId'],
      },
      request: {
        method: 'POST',
        path: '/environments/{sourceEnvironmentId}/fork',
        body: {
          data: {
            type: 'environment',
            id: '{newEnvironmentId}',
            attributes: { fast: '{fast}' },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List collaborator users on the project.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/users' },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Fetch a single collaborator by id.',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'string' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: '/users/{userId}' },
    },
    {
      name: 'webhooks.list',
      class: 'read',
      description: 'List configured webhooks on the project.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/webhooks' },
    },
    {
      name: 'webhooks.get',
      class: 'read',
      description: 'Fetch a single webhook by id.',
      parameters: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
      request: { method: 'GET', path: '/webhooks/{webhookId}' },
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description: 'Create a webhook subscription.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          events: { type: 'array' },
          headers: { type: 'object' },
          enabled: { type: 'boolean' },
        },
        required: ['name', 'url', 'events'],
      },
      request: {
        method: 'POST',
        path: '/webhooks',
        body: {
          data: {
            type: 'webhook',
            attributes: {
              name: '{name}',
              url: '{url}',
              events: '{events}',
              headers: '{headers}',
              enabled: '{enabled}',
            },
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Delete a webhook subscription.',
      parameters: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
      request: { method: 'DELETE', path: '/webhooks/{webhookId}' },
      cas: 'optimistic-read-verify',
    },
  ],
})
