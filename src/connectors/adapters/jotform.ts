import { declarativeRestConnector } from './declarative-rest.js'

// Jotform exposes a documented REST API at https://api.jotform.com (US data
// residency) or https://eu-api.jotform.com (EU). Both share an identical path
// surface; the connection's region selects the base host. Authentication is a
// static API key the caller pastes from My Account > API; Jotform accepts it
// in an `APIKEY` HTTP header. The activepieces piece classifies Jotform as a
// "webhook" category because the only published trigger is `newSubmission`
// (form-level webhook subscription); we keep that classification and expose
// the underlying REST surface that backs the trigger plus the read endpoints
// agents need to discover forms and pull historical submissions.
export const jotformConnector = declarativeRestConnector({
  kind: 'jotform',
  displayName: 'Jotform',
  description:
    'Read Jotform forms and submissions, create new submissions, and manage per-form webhook subscriptions that back the New Submission trigger.',
  auth: {
    kind: 'api-key',
    hint: 'Jotform API key from My Account > API. Sent as the APIKEY header.',
  },
  category: 'webhook',
  defaultConsistencyModel: 'authoritative',
  // US default; EU customers should mint a connection against the EU host by
  // overriding `baseUrl` via the connector instance (the metadata-keyed form
  // is used by OAuth connectors; Jotform's per-region host is selected at
  // connection time, so a static default is correct for the catalog manifest).
  baseUrl: 'https://api.jotform.com',
  credentialPlacement: { kind: 'header', header: 'APIKEY' },
  defaultHeaders: { Accept: 'application/json' },
  // /user is the canonical "am I authenticated" probe — cheap, no side effects,
  // returns the account record the key resolves to.
  test: { method: 'GET', path: '/user' },
  capabilities: [
    {
      name: 'forms.list',
      class: 'read',
      description:
        'List every form on the account. Supports paging (limit/offset), free-text filter, and status filter (ENABLED / DISABLED / DELETED).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max results per page (Jotform caps at 1000).' },
          offset: { type: 'integer', description: 'Zero-based offset into the result set.' },
          filter: {
            type: 'string',
            description: 'Jotform JSON filter expression, URL-encoded.',
          },
          orderby: {
            type: 'string',
            description: 'Field to sort by, e.g. created_at, updated_at, title.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/user/forms',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          filter: '{filter}',
          orderby: '{orderby}',
        },
      },
    },
    {
      name: 'form.get',
      class: 'read',
      description: 'Fetch a single form record (title, status, counts, created/updated timestamps).',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/form/{formId}' },
    },
    {
      name: 'form.questions',
      class: 'read',
      description:
        'List the question definitions for a form — needed to map submission answer keys back to human-readable field labels.',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/form/{formId}/questions' },
    },
    {
      name: 'form.submissions.list',
      class: 'read',
      description:
        'Page through historical submissions for a form. Use filter (Jotform JSON expression) for date ranges and orderby for chronological pulls.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          limit: { type: 'integer', description: 'Max results per page (Jotform caps at 1000).' },
          offset: { type: 'integer', description: 'Zero-based offset into the result set.' },
          filter: { type: 'string', description: 'Jotform JSON filter expression, URL-encoded.' },
          orderby: {
            type: 'string',
            description: 'Sort key — typically created_at for chronological pulls.',
          },
        },
        required: ['formId'],
      },
      request: {
        method: 'GET',
        path: '/form/{formId}/submissions',
        query: {
          limit: '{limit}',
          offset: '{offset}',
          filter: '{filter}',
          orderby: '{orderby}',
        },
      },
    },
    {
      name: 'submission.get',
      class: 'read',
      description: 'Fetch a single submission by ID with its answer payload.',
      parameters: {
        type: 'object',
        properties: { submissionId: { type: 'string' } },
        required: ['submissionId'],
      },
      request: { method: 'GET', path: '/submission/{submissionId}' },
    },
    {
      name: 'form.webhooks.list',
      class: 'read',
      description: 'List webhook URLs registered against a form (the subscriptions backing New Submission triggers).',
      parameters: {
        type: 'object',
        properties: { formId: { type: 'string' } },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/form/{formId}/webhooks' },
    },
    {
      name: 'submission.create',
      class: 'mutation',
      description:
        'Create a submission against a form. `submission` is a Jotform-shaped object keyed by question id (e.g. { "1": "value", "2_first": "Jane" }).',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          submission: {
            type: 'object',
            description: 'Answer payload keyed by question id (or composite key for multi-field controls).',
          },
        },
        required: ['formId', 'submission'],
      },
      request: {
        method: 'POST',
        path: '/form/{formId}/submissions',
        body: { submission: '{submission}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'submission.update',
      class: 'mutation',
      description: 'Edit an existing submission. Body keys mirror the create shape (question-id keyed).',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string' },
          submission: { type: 'object' },
        },
        required: ['submissionId', 'submission'],
      },
      request: {
        method: 'POST',
        path: '/submission/{submissionId}',
        body: { submission: '{submission}' },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'submission.delete',
      class: 'mutation',
      description: 'Permanently delete a submission.',
      parameters: {
        type: 'object',
        properties: { submissionId: { type: 'string' } },
        required: ['submissionId'],
      },
      request: { method: 'DELETE', path: '/submission/{submissionId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'form.webhooks.create',
      class: 'mutation',
      description:
        'Register a webhook URL that Jotform will POST to for every new submission to the form. Backs the activepieces "New Submission" trigger.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          webhookURL: {
            type: 'string',
            description: 'HTTPS endpoint Jotform will POST submissions to.',
          },
        },
        required: ['formId', 'webhookURL'],
      },
      request: {
        method: 'POST',
        path: '/form/{formId}/webhooks',
        body: { webhookURL: '{webhookURL}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'form.webhooks.delete',
      class: 'mutation',
      description: 'Remove a previously-registered webhook subscription by its index id on a form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string' },
          webhookId: {
            type: 'string',
            description: 'Jotform returns webhooks as an indexed list; this is the numeric index id.',
          },
        },
        required: ['formId', 'webhookId'],
      },
      request: { method: 'DELETE', path: '/form/{formId}/webhooks/{webhookId}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
  ],
})
