import { declarativeRestConnector } from './declarative-rest.js'

// DocuSign eSignature REST API.
//
// Per-account base URI: DocuSign's OAuth userinfo response returns an
// `accounts[]` array with `base_uri` (e.g. https://na4.docusign.net) and
// `account_id`. The runtime must persist both on the connection so subsequent
// calls land on the correct data center. We expose them as `metadata.baseUri`
// and `metadata.accountId`; every path here is rooted at
// `{baseUri}/restapi/v2.1/accounts/{accountId}/...`. We default the host to
// `https://demo.docusign.net` so sandbox/dev integrations work before the
// runtime has captured the live base URI — production tenants MUST overwrite
// `metadata.baseUri` from the userinfo lookup; the fallback is not a valid
// production target.
//
// Auth: standard OAuth2 (authorization-code) against the global account host.
// `signature` is the only required scope for the REST API. We also request
// `extended` so refresh tokens are issued (the equivalent of `offline_access`
// on other providers). We deliberately do NOT request `impersonation` — that
// requires the JWT grant flow which the declarative-rest substrate does not
// support; tenants needing service-account behavior will need a bespoke
// adapter.
//
// Account ID is interpolated into every path as `{accountId}`. Callers MUST
// pass it explicitly per-action rather than relying on a global default; this
// matches how DocuSign issues the userinfo response (one OAuth grant can be
// tied to multiple accounts) and keeps the adapter stateless. Mutations are
// `native-idempotency` because DocuSign honors clients' `X-DocuSign-Reason`
// header but not a true idempotency key — the runtime guards against
// double-submits via its own dedup table.

export const docusignConnector = declarativeRestConnector({
  kind: 'docusign',
  displayName: 'DocuSign',
  description:
    'Create, send, and manage DocuSign envelopes; list templates and inspect recipient signing status.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://account.docusign.com/oauth/auth',
    tokenUrl: 'https://account.docusign.com/oauth/token',
    scopes: ['signature', 'extended'],
    clientIdEnv: 'DOCUSIGN_OAUTH_CLIENT_ID',
    clientSecretEnv: 'DOCUSIGN_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUri', fallback: 'https://demo.docusign.net' },
  test: { method: 'GET', path: '/restapi/v2.1/accounts/{accountId}' },
  capabilities: [
    {
      name: 'envelopes.list',
      class: 'read',
      description:
        'List envelopes for an account, optionally filtered by status, date range, or folder.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          from_date: {
            type: 'string',
            description: 'ISO-8601 date; only envelopes changed at or after this time are returned.',
          },
          to_date: { type: 'string', description: 'ISO-8601 upper bound on envelope last-change time.' },
          status: {
            type: 'string',
            description: 'Comma-separated list of envelope statuses, e.g. sent,delivered,completed.',
          },
          folder_ids: { type: 'string', description: 'Comma-separated folder ids to restrict the search.' },
          search_text: { type: 'string' },
          count: { type: 'integer', minimum: 1, maximum: 100 },
          start_position: { type: 'integer', minimum: 0 },
        },
        required: ['accountId', 'from_date'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes',
        query: {
          from_date: '{from_date}',
          to_date: '{to_date}',
          status: '{status}',
          folder_ids: '{folder_ids}',
          search_text: '{search_text}',
          count: '{count}',
          start_position: '{start_position}',
        },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.get',
      class: 'read',
      description:
        'Read a single envelope by id. Pass include=recipients,tabs,documents to expand the response.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          include: {
            type: 'string',
            description: 'Comma-separated expansion list: recipients, tabs, documents, custom_fields.',
          },
          advanced_update: { type: 'boolean' },
        },
        required: ['accountId', 'envelopeId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}',
        query: { include: '{include}', advanced_update: '{advanced_update}' },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.create',
      class: 'mutation',
      description:
        'Create and optionally send an envelope. Set status="sent" to dispatch immediately; status="created" leaves it as a draft.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          emailSubject: { type: 'string' },
          emailBlurb: { type: 'string' },
          status: { type: 'string', enum: ['created', 'sent'] },
          documents: {
            type: 'array',
            items: { type: 'object' },
            description: 'Document descriptors: name, documentId, fileExtension, documentBase64.',
          },
          recipients: {
            type: 'object',
            description: 'Recipients envelope, e.g. { signers: [...], carbonCopies: [...] }.',
          },
          templateId: { type: 'string' },
          templateRoles: { type: 'array', items: { type: 'object' } },
          customFields: { type: 'object' },
          eventNotification: { type: 'object' },
          brandId: { type: 'string' },
        },
        required: ['accountId', 'emailSubject'],
      },
      request: {
        method: 'POST',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.update',
      class: 'mutation',
      description:
        'Update an existing envelope: change status (e.g. created → sent to dispatch a draft), patch metadata, or void it via status="voided" with a voidedReason.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          status: { type: 'string', enum: ['sent', 'voided', 'created', 'correct'] },
          voidedReason: { type: 'string' },
          emailSubject: { type: 'string' },
          emailBlurb: { type: 'string' },
          purgeState: { type: 'string', enum: ['unpurged', 'documents_queued', 'documents_and_metadata_queued'] },
          advanced_update: { type: 'boolean' },
        },
        required: ['accountId', 'envelopeId'],
      },
      request: {
        method: 'PUT',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}',
        query: { advanced_update: '{advanced_update}' },
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.recipients.list',
      class: 'read',
      description:
        'List recipients of an envelope, including signing status, routing order, and tabs when expanded.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          include_tabs: { type: 'boolean' },
          include_extended: { type: 'boolean' },
          include_metadata: { type: 'boolean' },
        },
        required: ['accountId', 'envelopeId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}/recipients',
        query: {
          include_tabs: '{include_tabs}',
          include_extended: '{include_extended}',
          include_metadata: '{include_metadata}',
        },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.recipients.update',
      class: 'mutation',
      description:
        'Modify or add recipients on an in-flight envelope. resend_envelope=true triggers a fresh signing notice.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          resend_envelope: { type: 'boolean' },
          signers: { type: 'array', items: { type: 'object' } },
          carbonCopies: { type: 'array', items: { type: 'object' } },
          certifiedDeliveries: { type: 'array', items: { type: 'object' } },
        },
        required: ['accountId', 'envelopeId'],
      },
      request: {
        method: 'PUT',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}/recipients',
        query: { resend_envelope: '{resend_envelope}' },
        body: 'args',
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.documents.list',
      class: 'read',
      description: 'List documents attached to an envelope.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          include_metadata: { type: 'boolean' },
          include_tabs: { type: 'boolean' },
          documents_by_userid: { type: 'boolean' },
        },
        required: ['accountId', 'envelopeId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}/documents',
        query: {
          include_metadata: '{include_metadata}',
          include_tabs: '{include_tabs}',
          documents_by_userid: '{documents_by_userid}',
        },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'templates.list',
      class: 'read',
      description: 'List account-level templates, optionally filtered by folder, shared status, or search text.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          folder_ids: { type: 'string' },
          search_text: { type: 'string' },
          shared: { type: 'string', enum: ['shared_with_me', 'all'] },
          order_by: { type: 'string' },
          order: { type: 'string', enum: ['asc', 'desc'] },
          count: { type: 'integer', minimum: 1, maximum: 100 },
          start_position: { type: 'integer', minimum: 0 },
        },
        required: ['accountId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/templates',
        query: {
          folder_ids: '{folder_ids}',
          search_text: '{search_text}',
          shared: '{shared}',
          order_by: '{order_by}',
          order: '{order}',
          count: '{count}',
          start_position: '{start_position}',
        },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'templates.get',
      class: 'read',
      description: 'Read a single template definition by id.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          templateId: { type: 'string' },
          include: { type: 'string' },
        },
        required: ['accountId', 'templateId'],
      },
      request: {
        method: 'GET',
        path: '/restapi/v2.1/accounts/{accountId}/templates/{templateId}',
        query: { include: '{include}' },
      },
      requiredScopes: ['signature'],
    },
    {
      name: 'envelopes.views.recipient',
      class: 'mutation',
      description:
        'Create an embedded-signing recipient view URL. The returned `url` is a one-time link the caller redirects the signer into.',
      parameters: {
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          envelopeId: { type: 'string' },
          returnUrl: { type: 'string' },
          authenticationMethod: { type: 'string' },
          clientUserId: { type: 'string' },
          email: { type: 'string' },
          userName: { type: 'string' },
          frameAncestors: { type: 'array', items: { type: 'string' } },
          messageOrigins: { type: 'array', items: { type: 'string' } },
        },
        required: ['accountId', 'envelopeId', 'returnUrl', 'authenticationMethod', 'clientUserId', 'email', 'userName'],
      },
      request: {
        method: 'POST',
        path: '/restapi/v2.1/accounts/{accountId}/envelopes/{envelopeId}/views/recipient',
        body: 'args',
      },
      cas: 'native-idempotency',
      externalEffect: false,
      requiredScopes: ['signature'],
    },
  ],
})
