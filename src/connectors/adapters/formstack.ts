import { declarativeRestConnector } from './declarative-rest.js'

// Formstack is a form-builder / data-collection product. Its v2 REST API is
// organised around two top-level resources: `/form` (form definitions, with
// per-form `submission` subresources) and `/submission/{id}` (individual
// submissions, looked up by submission id). OAuth2 is the only supported
// authorization scheme; the bearer access token is sent as `Authorization:
// Bearer <token>` and refresh tokens are long-lived. We expose the four
// catalog actions verbatim — create a submission, look up a form by name or
// id, fetch a submission's full field payload, and find a submission whose
// indexed field equals a given value — plus the read primitive needed for the
// "find by name or id" planner step (listing forms with a name filter).
export const formstackConnector = declarativeRestConnector({
  kind: 'formstack',
  displayName: 'Formstack',
  description:
    'Create Formstack submissions and look up forms or submissions through the Formstack v2 REST API.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.formstack.com/api/v2/oauth2/authorize',
    tokenUrl: 'https://www.formstack.com/api/v2/oauth2/request_token.json',
    scopes: ['read', 'write'],
    clientIdEnv: 'FORMSTACK_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FORMSTACK_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://www.formstack.com/api/v2',
  test: { method: 'GET', path: '/form.json' },
  capabilities: [
    {
      name: 'forms.find',
      class: 'read',
      description:
        'List Formstack forms, optionally filtered by a case-insensitive name substring (powers "find form by name or id").',
      parameters: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Folder id to scope the list to, if the workspace organises forms in folders.',
          },
          folders: {
            type: 'boolean',
            description: 'When true, response includes the folder tree alongside forms.',
          },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/form.json',
        query: {
          folder: '{folder}',
          folders: '{folders}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'forms.get',
      class: 'read',
      description:
        'Fetch a single Formstack form definition by id, including the field list needed to build a submission payload.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Formstack form id.' },
        },
        required: ['formId'],
      },
      request: { method: 'GET', path: '/form/{formId}.json' },
      requiredScopes: ['read'],
    },
    {
      name: 'submissions.create',
      class: 'mutation',
      description:
        'Create a new submission against a form. `fields` is keyed by Formstack field id; non-field metadata (read_only, payment_status, etc.) is passed at the top level.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Form to submit to.' },
          fields: {
            type: 'object',
            description: 'Map of Formstack field id → value (string, number, or field-specific object).',
          },
          timestamp: {
            type: 'string',
            description: 'Optional ISO-8601 timestamp; defaults to server-now when omitted.',
          },
          user_agent: { type: 'string' },
          remote_addr: { type: 'string', description: 'Originating IP recorded with the submission.' },
          payment_status: { type: 'string' },
          read: { type: 'boolean', description: 'Mark the submission read on create.' },
        },
        required: ['formId', 'fields'],
      },
      request: {
        method: 'POST',
        path: '/form/{formId}/submission.json',
        body: {
          fields: '{fields}',
          timestamp: '{timestamp}',
          user_agent: '{user_agent}',
          remote_addr: '{remote_addr}',
          payment_status: '{payment_status}',
          read: '{read}',
        },
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'submissions.get',
      class: 'read',
      description:
        'Fetch a submission by id with all field values resolved into their human-readable form (powers "get submission details").',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', description: 'Formstack submission id.' },
          encryption_password: {
            type: 'string',
            description: 'Required when the form uses field-level encryption — only then are encrypted fields decrypted in the response.',
          },
        },
        required: ['submissionId'],
      },
      request: {
        method: 'GET',
        path: '/submission/{submissionId}.json',
        query: { encryption_password: '{encryption_password}' },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'submissions.delete',
      class: 'mutation',
      description:
        'Delete a Formstack submission by id. Destructive; not idempotent on the same submission id after success.',
      parameters: {
        type: 'object',
        properties: {
          submissionId: { type: 'string', description: 'Formstack submission id to delete.' },
        },
        required: ['submissionId'],
      },
      request: { method: 'DELETE', path: '/submission/{submissionId}.json' },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'forms.create',
      class: 'mutation',
      description:
        'Create a new Formstack form. `name` is required; `folder` and `language` are optional placement/locale hints. Fields can be added in follow-up calls via the field-management endpoints.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Form display name.' },
          folder: { type: 'string', description: 'Folder id to place the form in.' },
          language: {
            type: 'string',
            description: 'ISO 639-1 language code for built-in form copy (defaults to account default).',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/form.json',
        body: 'args',
      },
      cas: 'native-idempotency',
      requiredScopes: ['write'],
      externalEffect: true,
    },
    {
      name: 'submissions.search',
      class: 'read',
      description:
        'Search submissions of a form by an indexed field value (powers "find submission by field value"). Returns submissions whose `fieldId` equals `value` within the form.',
      parameters: {
        type: 'object',
        properties: {
          formId: { type: 'string', description: 'Form id to search within.' },
          fieldId: { type: 'string', description: 'Formstack field id that should equal `value`.' },
          value: {
            type: 'string',
            description: 'Value to match against the indexed field — Formstack supports exact match for searchable field types.',
          },
          min_time: {
            type: 'string',
            description: 'Earliest submission timestamp (UTC, "YYYY-MM-DD HH:MM:SS").',
          },
          max_time: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100 },
          sort: { type: 'string', enum: ['ASC', 'DESC'] },
          data: {
            type: 'boolean',
            description: 'When true, response includes full submission `data` blocks (otherwise only ids/timestamps).',
          },
          expand_data: { type: 'boolean' },
        },
        required: ['formId', 'fieldId', 'value'],
      },
      request: {
        method: 'GET',
        path: '/form/{formId}/submission.json',
        query: {
          search_field_1: '{fieldId}',
          search_value_1: '{value}',
          min_time: '{min_time}',
          max_time: '{max_time}',
          page: '{page}',
          per_page: '{per_page}',
          sort: '{sort}',
          data: '{data}',
          expand_data: '{expand_data}',
        },
      },
      requiredScopes: ['read'],
    },
  ],
})
