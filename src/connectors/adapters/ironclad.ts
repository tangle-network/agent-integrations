import { declarativeRestConnector } from './declarative-rest.js'

// Ironclad Public API (Contract Lifecycle Management).
//
// Region routing: Ironclad operates two production data centers — `us`
// (https://ironcladapp.com) and `eu` (https://eu1.ironcladapp.com). The OAuth
// authorization + token endpoints live on the US host for both regions; the
// region split applies only to the public API surface. We expose `baseUrl` as
// `metadata.baseUrl` with a US-host fallback so a tenant whose workspace lives
// on the EU instance can flip the resolved data source's `metadata.baseUrl` to
// `https://eu1.ironcladapp.com` without rebuilding the manifest. Every path is
// rooted at `{baseUrl}/public/api/v1/...`.
//
// Auth: standard OAuth2 (authorization-code) "Connected App" flow. Ironclad
// scopes are coarse — `read` and `write` cover the Workflow + Records APIs the
// catalog action pack exposes. We deliberately do NOT request the
// `workflows:approve` scope; counter-signing has financial-action semantics
// and must be gated by the application's own approval flow before reaching
// the connector. Tenants needing approval automation should ship a bespoke
// adapter with that scope pinned and an explicit human-in-the-loop guard.
//
// Workflow IDs are interpolated into every path. Mutations use
// `native-idempotency` because Ironclad responses include workflow + revision
// metadata that the runtime can cross-check, but the platform does not honor
// a client-supplied idempotency key header. Comments are write-only; the
// runtime cannot dedupe them through ETag, so the consumer must scope its own
// dedupe window when emitting comment events from an automation loop.

export const ironcladConnector = declarativeRestConnector({
  kind: 'ironclad',
  displayName: 'Ironclad',
  description:
    'Read and mutate Ironclad workflows, records, and approval state across the contract lifecycle.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://ironcladapp.com/oauth/authorize',
    tokenUrl: 'https://ironcladapp.com/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnv: 'IRONCLAD_OAUTH_CLIENT_ID',
    clientSecretEnv: 'IRONCLAD_OAUTH_CLIENT_SECRET',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://ironcladapp.com' },
  test: { method: 'GET', path: '/public/api/v1/workflows' },
  capabilities: [
    {
      name: 'workflows.list',
      class: 'read',
      description:
        'List Ironclad workflows, optionally filtered by status, schema, or last-updated window. Page with `cursor`.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Workflow status filter, e.g. draft, review, signing, signed, cancelled, archived.',
          },
          schemaId: { type: 'string', description: 'Restrict to a single workflow schema.' },
          asUserId: {
            type: 'string',
            description: 'Run the request as this Ironclad user id; visibility scopes to their permissions.',
          },
          lastUpdated: {
            type: 'string',
            description: 'ISO-8601 lower bound on workflow.lastUpdated (filters to workflows changed at or after this time).',
          },
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/public/api/v1/workflows',
        query: {
          status: '{status}',
          schemaId: '{schemaId}',
          asUserId: '{asUserId}',
          lastUpdated: '{lastUpdated}',
          page: '{page}',
          pageSize: '{pageSize}',
          cursor: '{cursor}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'workflows.get',
      class: 'read',
      description: 'Read a single Ironclad workflow by id, including attributes, status, and participants.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          asUserId: { type: 'string' },
        },
        required: ['workflowId'],
      },
      request: {
        method: 'GET',
        path: '/public/api/v1/workflows/{workflowId}',
        query: { asUserId: '{asUserId}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'workflows.create',
      class: 'mutation',
      description:
        'Launch a new workflow from a published workflow schema. `attributes` is a map of schema field id → value matching the schema definition.',
      parameters: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Workflow schema id this workflow instantiates.' },
          creator: {
            type: 'object',
            description: 'Ironclad user creating the workflow, e.g. { email: "user@example.com" }.',
          },
          attributes: {
            type: 'object',
            description: 'Schema field id → value map; field types must match the schema (string, number, date, monetaryAmount, etc.).',
          },
          launch: {
            type: 'boolean',
            description: 'If true, advance the workflow past the create step immediately.',
          },
        },
        required: ['template', 'creator', 'attributes'],
      },
      request: {
        method: 'POST',
        path: '/public/api/v1/workflows',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'workflows.attributes.update',
      class: 'mutation',
      description:
        'Patch attribute values on an in-flight workflow. Only fields present in the request are overwritten.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          attributes: {
            type: 'object',
            description: 'Schema field id → new value map. Pass null to clear a field.',
          },
          asUserId: { type: 'string' },
        },
        required: ['workflowId', 'attributes'],
      },
      request: {
        method: 'PATCH',
        path: '/public/api/v1/workflows/{workflowId}/attributes',
        query: { asUserId: '{asUserId}' },
        body: { attributes: '{attributes}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'workflows.turn',
      class: 'mutation',
      description:
        'Advance a workflow to the next step (e.g. review → sign → signed). Returns the new step descriptor.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          actionId: {
            type: 'string',
            description: 'Optional turn action id when the step exposes multiple branches (e.g. "approve" vs "reject").',
          },
          asUserId: { type: 'string' },
        },
        required: ['workflowId'],
      },
      request: {
        method: 'POST',
        path: '/public/api/v1/workflows/{workflowId}/turn',
        query: { asUserId: '{asUserId}' },
        body: { actionId: '{actionId}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'workflows.cancel',
      class: 'mutation',
      description: 'Cancel an in-flight workflow. Once cancelled the workflow cannot be resumed; create a new one instead.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          reason: { type: 'string' },
          asUserId: { type: 'string' },
        },
        required: ['workflowId'],
      },
      request: {
        method: 'POST',
        path: '/public/api/v1/workflows/{workflowId}/cancel',
        query: { asUserId: '{asUserId}' },
        body: { reason: '{reason}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'workflows.comments.list',
      class: 'read',
      description: 'List comments on a workflow, including system events and human-authored notes.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
        required: ['workflowId'],
      },
      request: {
        method: 'GET',
        path: '/public/api/v1/workflows/{workflowId}/comments',
        query: { page: '{page}', pageSize: '{pageSize}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'workflows.comments.create',
      class: 'mutation',
      description:
        'Post a comment on a workflow. Comments are write-only — there is no server-side dedupe, so callers must scope their own dedupe window.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
          comment: { type: 'string' },
          asUserId: { type: 'string' },
        },
        required: ['workflowId', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/public/api/v1/workflows/{workflowId}/comments',
        query: { asUserId: '{asUserId}' },
        body: { comment: '{comment}' },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'workflows.documents.list',
      class: 'read',
      description: 'List documents (drafts, signed copies, attachments) on an Ironclad workflow.',
      parameters: {
        type: 'object',
        properties: {
          workflowId: { type: 'string' },
        },
        required: ['workflowId'],
      },
      request: { method: 'GET', path: '/public/api/v1/workflows/{workflowId}/documents' },
      requiredScopes: ['read'],
    },
    {
      name: 'workflow-schemas.list',
      class: 'read',
      description: 'List the published workflow schemas available in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/public/api/v1/workflow-schemas',
        query: { page: '{page}', pageSize: '{pageSize}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'workflow-schemas.get',
      class: 'read',
      description: 'Read a single workflow schema definition (field types, required fields, step graph).',
      parameters: {
        type: 'object',
        properties: { schemaId: { type: 'string' } },
        required: ['schemaId'],
      },
      request: { method: 'GET', path: '/public/api/v1/workflow-schemas/{schemaId}' },
      requiredScopes: ['read'],
    },
    {
      name: 'records.list',
      class: 'read',
      description:
        'List Repository records (signed contracts and uploaded counter-party paper). Filter by record type or last-updated window.',
      parameters: {
        type: 'object',
        properties: {
          recordType: { type: 'string', description: 'Repository record type id.' },
          lastUpdated: { type: 'string' },
          page: { type: 'integer', minimum: 0 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/public/api/v1/records',
        query: {
          recordType: '{recordType}',
          lastUpdated: '{lastUpdated}',
          page: '{page}',
          pageSize: '{pageSize}',
          cursor: '{cursor}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'records.get',
      class: 'read',
      description: 'Read a single Repository record by id, including its property values.',
      parameters: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
      },
      request: { method: 'GET', path: '/public/api/v1/records/{recordId}' },
      requiredScopes: ['read'],
    },
    {
      name: 'records.update',
      class: 'mutation',
      description:
        'Patch property values on a Repository record. Only fields present in `properties` are overwritten.',
      parameters: {
        type: 'object',
        properties: {
          recordId: { type: 'string' },
          properties: {
            type: 'object',
            description: 'Property id → new value map. Property types must match the record type schema.',
          },
        },
        required: ['recordId', 'properties'],
      },
      request: {
        method: 'PATCH',
        path: '/public/api/v1/records/{recordId}',
        body: { properties: '{properties}' },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['write'],
    },
    {
      name: 'webhooks.list',
      class: 'read',
      description: 'List active webhook subscriptions for the workspace.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/public/api/v1/webhooks' },
      requiredScopes: ['read'],
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description: 'Register a webhook subscription. `events` is an array of Ironclad event names (e.g. workflow.launched, workflow.signed).',
      parameters: {
        type: 'object',
        properties: {
          targetURL: { type: 'string' },
          events: { type: 'array', items: { type: 'string' } },
        },
        required: ['targetURL', 'events'],
      },
      request: {
        method: 'POST',
        path: '/public/api/v1/webhooks',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Remove a webhook subscription by id.',
      parameters: {
        type: 'object',
        properties: { webhookId: { type: 'string' } },
        required: ['webhookId'],
      },
      request: { method: 'DELETE', path: '/public/api/v1/webhooks/{webhookId}' },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
    },
  ],
})
