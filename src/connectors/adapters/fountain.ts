import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Fountain ATS (https://developer.fountain.com).
 *
 * HR hiring + onboarding platform. Auth is an API key obtained from
 * Profile > Manage API Keys (or Settings > Integrations & API Keys),
 * sent as `X-ACCESS-TOKEN: <apiKey>` per Fountain's REST conventions.
 *
 * Default base URL is https://api.fountain.com/v2; the catalog notes
 * regional deployments such as us-2.fountain.com/api/v2 — callers that
 * need a regional host should override via metadata.baseUrl.
 */
export const fountainConnector = declarativeRestConnector({
  kind: 'fountain',
  displayName: 'Fountain',
  description:
    'Manage Fountain applicants, openings, stages, and interview sessions across the hiring + onboarding workflow.',
  auth: {
    kind: 'api-key',
    hint: 'Fountain API key from Profile > Manage API Keys or Settings > Integrations & API Keys. Sent as X-ACCESS-TOKEN.',
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: { metadataKey: 'baseUrl', fallback: 'https://api.fountain.com/v2' },
  credentialPlacement: { kind: 'header', header: 'X-ACCESS-TOKEN' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'GET', path: '/openings', query: { per_page: 1 } },
  capabilities: [
    {
      name: 'applicants.list',
      class: 'read',
      description:
        'List applicants with optional filters by funnel (opening), location, stage, labels, phone, and pagination cursor.',
      parameters: {
        type: 'object',
        properties: {
          funnel_id: { type: 'string' },
          location_id: { type: 'string' },
          stage_id: { type: 'string' },
          stage: { type: 'string' },
          labels: { type: 'string' },
          phone: { type: 'string' },
          exclude_temporary: { type: 'boolean' },
          per_page: { type: 'integer' },
          cursor: { type: 'string' },
          include_subaccounts: { type: 'boolean' },
        },
      },
      request: {
        method: 'GET',
        path: '/applicants',
        query: {
          funnel_id: '{funnel_id}',
          location_id: '{location_id}',
          stage_id: '{stage_id}',
          stage: '{stage}',
          labels: '{labels}',
          phone: '{phone}',
          exclude_temporary: '{exclude_temporary}',
          per_page: '{per_page}',
          cursor: '{cursor}',
          include_subaccounts: '{include_subaccounts}',
        },
      },
    },
    {
      name: 'applicants.get',
      class: 'read',
      description: 'Fetch a single applicant by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'GET', path: '/applicants/{id}' },
    },
    {
      name: 'applicants.create',
      class: 'mutation',
      description: 'Create a Fountain applicant on an opening (funnel).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          funnel_id: { type: 'string' },
          check_if_applicant_is_duplicate: { type: 'boolean' },
          data: { type: 'object' },
          secure_data: { type: 'object' },
        },
        required: ['name', 'email', 'phone_number'],
      },
      request: {
        method: 'POST',
        path: '/applicants',
        body: {
          name: '{name}',
          email: '{email}',
          phone_number: '{phone_number}',
          funnel_id: '{funnel_id}',
          check_if_applicant_is_duplicate: '{check_if_applicant_is_duplicate}',
          data: '{data}',
          secure_data: '{secure_data}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'applicants.update',
      class: 'mutation',
      description: 'Update an existing applicant: custom data, secure data, and rejection reason.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          phone_number: { type: 'string' },
          data: { type: 'object' },
          secure_data: { type: 'object' },
          rejection_reason: { type: 'string' },
          labels: { type: 'string' },
        },
        required: ['id'],
      },
      request: {
        method: 'PUT',
        path: '/applicants/{id}',
        body: {
          name: '{name}',
          email: '{email}',
          phone_number: '{phone_number}',
          data: '{data}',
          secure_data: '{secure_data}',
          rejection_reason: '{rejection_reason}',
          labels: '{labels}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'applicants.delete',
      class: 'mutation',
      description: 'Delete an applicant by id. Destructive; not idempotent on the same id after success.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/applicants/{id}' },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'applicants.interviewSessions',
      class: 'read',
      description: 'List interview sessions scheduled for an applicant.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          per_page: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/applicants/{id}/interview_sessions',
        query: { per_page: '{per_page}', cursor: '{cursor}' },
      },
    },
    {
      name: 'openings.list',
      class: 'read',
      description: 'List openings (funnels), with filters for active, private, owner, and hiring/sourcing funnel flags.',
      parameters: {
        type: 'object',
        properties: {
          active: { type: 'boolean' },
          is_hiring_funnel: { type: 'boolean' },
          is_sourcing_funnel: { type: 'boolean' },
          is_private: { type: 'boolean' },
          owner_id: { type: 'string' },
          per_page: { type: 'integer' },
          cursor: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/openings',
        query: {
          active: '{active}',
          is_hiring_funnel: '{is_hiring_funnel}',
          is_sourcing_funnel: '{is_sourcing_funnel}',
          is_private: '{is_private}',
          owner_id: '{owner_id}',
          per_page: '{per_page}',
          cursor: '{cursor}',
        },
      },
    },
    {
      name: 'openings.get',
      class: 'read',
      description: 'Fetch a single opening (funnel) by id.',
      parameters: {
        type: 'object',
        properties: { funnel_id: { type: 'string' } },
        required: ['funnel_id'],
      },
      request: { method: 'GET', path: '/openings/{funnel_id}' },
    },
    {
      name: 'stages.list',
      class: 'read',
      description: 'List stages for a given opening (funnel).',
      parameters: {
        type: 'object',
        properties: {
          funnel_id: { type: 'string' },
          per_page: { type: 'integer' },
          cursor: { type: 'string' },
        },
        required: ['funnel_id'],
      },
      request: {
        method: 'GET',
        path: '/openings/{funnel_id}/stages',
        query: { per_page: '{per_page}', cursor: '{cursor}' },
      },
    },
    {
      name: 'stages.get',
      class: 'read',
      description: 'Fetch a single stage on an opening by stage id.',
      parameters: {
        type: 'object',
        properties: {
          funnel_id: { type: 'string' },
          stage_id: { type: 'string' },
        },
        required: ['funnel_id', 'stage_id'],
      },
      request: { method: 'GET', path: '/openings/{funnel_id}/stages/{stage_id}' },
    },
  ],
})
