import { declarativeRestConnector } from './declarative-rest.js'

// Fillout exposes a REST API rooted at https://api.fillout.com. All routes used
// by the upstream activepieces piece (Get Form Responses, Get Single Response,
// Find Form By Title, New Form Response trigger) live under /v1/api. The
// catalog classes Fillout under the "webhook" category because the primary
// integration surface is response delivery (polling + webhook trigger); we
// keep that classification for catalog parity. Auth is a static API key the
// caller pastes from the Fillout dashboard, sent as a Bearer token.
export const filloutFormsConnector = declarativeRestConnector({
  kind: 'fillout-forms',
  displayName: 'Fillout Forms',
  description:
    'Read Fillout form metadata and submissions: list forms, fetch a single response, page through submissions with status/date filters, and find a form by title.',
  auth: { kind: 'api-key', hint: 'Fillout API key (Bearer) from Settings > Developer.' },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.fillout.com',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { Accept: 'application/json' },
  test: { method: 'GET', path: '/v1/api/forms' },
  capabilities: [
    {
      name: 'forms.list',
      class: 'read',
      description: 'List every form on the workspace. Used to discover form IDs and titles.',
      parameters: { type: 'object', properties: {} },
      request: { method: 'GET', path: '/v1/api/forms' },
    },
    {
      name: 'form.metadata',
      class: 'read',
      description: 'Get a single form definition (questions, calculations, URL params).',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/v1/api/forms/{formId}' },
    },
    {
      name: 'find.form.by.title',
      class: 'read',
      description:
        'Find a Fillout form by partial or full title match. Mirrors the activepieces "Find Form By Title" action.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Partial or full form title to search for.' },
        },
        required: ['title'],
      },
      // Fillout has no server-side title search; the upstream piece lists forms
      // then filters client-side. The declarative layer can only emit a real
      // HTTP call, so we surface the underlying list endpoint and let the
      // caller (or a higher-level filter) match on title.
      request: { method: 'GET', path: '/v1/api/forms' },
    },
    {
      name: 'get.form.responses',
      class: 'read',
      description:
        'List submissions for a form. Supports paging (limit/offset), date range, status (finished/in_progress/all), sort order, free-text search, and optional edit-link + preview-response inclusion.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          limit: { type: 'integer', description: '1-150; default 50.' },
          afterDate: { type: 'string', description: 'ISO 8601 lower bound (inclusive).' },
          beforeDate: { type: 'string', description: 'ISO 8601 upper bound (inclusive).' },
          offset: { type: 'integer', description: 'Zero-based offset into the result set.' },
          status: {
            type: 'string',
            enum: ['finished', 'in_progress', 'all'],
            description: 'Default: finished.',
          },
          includeEditLink: { type: 'boolean' },
          includePreview: { type: 'boolean' },
          sort: { type: 'string', enum: ['asc', 'desc'] },
          search: { type: 'string' },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/v1/api/forms/{formId}/submissions',
        query: {
          limit: '{limit}',
          afterDate: '{afterDate}',
          beforeDate: '{beforeDate}',
          offset: '{offset}',
          status: '{status}',
          includeEditLink: '{includeEditLink}',
          includePreview: '{includePreview}',
          sort: '{sort}',
          search: '{search}',
        },
      },
    },
    {
      name: 'get.single.response',
      class: 'read',
      description: 'Fetch a single submission by its ID under a given form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          submissionId: { type: 'string' },
          includeEditLink: { type: 'boolean' },
        },
        required: ['formId', 'submissionId'],
      },
      request: {
        method: 'GET',
        path: '/v1/api/forms/{formId}/submissions/{submissionId}',
        query: { includeEditLink: '{includeEditLink}' },
      },
    },
    {
      name: 'webhooks.create',
      class: 'mutation',
      description:
        'Register a webhook URL that Fillout will POST to for every new submission to the form. Backs the activepieces "New Form Response" trigger.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          url: { type: 'string', description: 'HTTPS endpoint Fillout will POST submissions to.' },
        },
        required: ['formId', 'url'],
      },
      request: {
        method: 'POST',
        path: '/v1/api/forms/{formId}/webhook/create',
        body: { url: '{url}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'webhooks.delete',
      class: 'mutation',
      description: 'Remove a previously-registered webhook subscription by its ID.',
      parameters: {
        type: 'object',
        properties: {
          webhookId: { type: 'string' },
        },
        required: ['webhookId'],
      },
      request: {
        method: 'POST',
        path: '/v1/api/forms/webhook/delete',
        body: { webhookId: '{webhookId}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
