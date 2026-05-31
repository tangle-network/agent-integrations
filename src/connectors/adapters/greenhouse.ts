import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Greenhouse connector (Harvest API).
 *
 * Auth model: Greenhouse Harvest exposes per-tenant API keys
 * (Configure → Dev Center → API Credential Management → Create New API Key →
 * "Harvest"). The key authenticates via HTTP Basic with the key as the
 * username and an empty password — i.e. `Authorization: Basic
 * base64("<apiKey>:")`. Greenhouse also exposes Partner OAuth, but that
 * surface is gated to vetted ingest partners and is not self-serve for a
 * tenant; the Harvest key path is the one a customer can provision on their
 * own. We therefore model auth as `api-key` and expect the integrator to
 * persist `base64("<apiKey>:")` (the colon is mandatory — HTTP Basic
 * requires it even with an empty password) as the connection's `apiKey`
 * value. That string is placed verbatim into `Authorization: Basic <…>`.
 *
 * Base URL: `https://harvest.greenhouse.io/v1`. Greenhouse is single-region
 * for the standard product, so the base is constant; no metadata routing
 * required.
 *
 * On-Behalf-Of: Greenhouse asks mutation callers to send `On-Behalf-Of:
 * <userId>` so the action is attributed to a real Greenhouse user (audit log
 * + permission check). The integrator passes that user id through args as
 * `onBehalfOf`; capability requests that mutate Greenhouse state stamp it
 * into the request header. Reads omit it.
 *
 * Capability surface: Candidates (search, get, create, update, anonymize),
 * Applications (list, get, advance stage, reject, hire), Jobs (list, get,
 * list openings), Users (list, get), Offers (list, get), Scorecards (list,
 * get), Prospects (create). These cover the recruiter-automation jobs an
 * agent typically wires: candidate intake, application status checks, stage
 * progression, offer lookups, and ATS reporting.
 *
 * Consistency model: `authoritative` — Greenhouse is the system of record
 * for ATS data; downstream caches MUST defer to it on conflict.
 */

const GH_BASE_URL = 'https://harvest.greenhouse.io'
const GH_API_VERSION = 'v1'

export const greenhouseConnector = declarativeRestConnector({
  kind: 'greenhouse',
  displayName: 'Greenhouse',
  description:
    'Search, advance, and update Greenhouse candidates, applications, jobs, offers, and scorecards through the Harvest API.',
  auth: {
    kind: 'api-key',
    hint: 'Greenhouse Harvest API key. In Greenhouse: Configure → Dev Center → API Credential Management → Create New API Key → "Harvest". Persist the base64 of `<apiKey>:` (note the trailing colon — Basic auth requires it even with an empty password).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: GH_BASE_URL,
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Basic ' },
  defaultHeaders: {
    accept: 'application/json',
  },
  // Hitting /v1/users with per_page=1 is the cheapest auth probe Greenhouse
  // exposes; it 401s on a bad key and 200s with one row on a good one.
  test: { method: 'GET', path: `/${GH_API_VERSION}/users`, query: { per_page: 1 } },
  capabilities: [
    {
      name: 'candidates.search',
      class: 'read',
      description:
        'List or search Greenhouse candidates. Filter by email, updated_after, created_after, or job_id; paginate with page+per_page (max 500).',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          updated_after: { type: 'string', format: 'date-time' },
          updated_before: { type: 'string', format: 'date-time' },
          created_after: { type: 'string', format: 'date-time' },
          created_before: { type: 'string', format: 'date-time' },
          job_id: { type: 'integer' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/candidates`,
        query: {
          email: '{email}',
          updated_after: '{updated_after}',
          updated_before: '{updated_before}',
          created_after: '{created_after}',
          created_before: '{created_before}',
          job_id: '{job_id}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'candidates.get',
      class: 'read',
      description: 'Fetch a single Greenhouse candidate by id (includes nested applications, attachments, custom fields).',
      parameters: {
        type: 'object',
        properties: { candidateId: { type: 'integer' } },
        required: ['candidateId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/candidates/{candidateId}` },
    },
    {
      name: 'candidates.create',
      class: 'mutation',
      description:
        'Create a Greenhouse candidate. Body is the Harvest candidate payload (first_name, last_name, emails[], phone_numbers[], addresses[], social_media_addresses[], applications[], …). On-Behalf-Of is required.',
      parameters: {
        type: 'object',
        properties: {
          onBehalfOf: { type: 'string', description: 'Greenhouse user id to attribute the action to (audit log + permission check).' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          addresses: { type: 'array', items: { type: 'object' } },
          email_addresses: { type: 'array', items: { type: 'object' } },
          website_addresses: { type: 'array', items: { type: 'object' } },
          social_media_addresses: { type: 'array', items: { type: 'object' } },
          educations: { type: 'array', items: { type: 'object' } },
          employments: { type: 'array', items: { type: 'object' } },
          tags: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
          applications: { type: 'array', items: { type: 'object' } },
          activity_feed_notes: { type: 'array', items: { type: 'object' } },
        },
        required: ['onBehalfOf', 'first_name', 'last_name'],
      },
      request: {
        method: 'POST',
        path: `/${GH_API_VERSION}/candidates`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          company: '{company}',
          title: '{title}',
          phone_numbers: '{phone_numbers}',
          addresses: '{addresses}',
          email_addresses: '{email_addresses}',
          website_addresses: '{website_addresses}',
          social_media_addresses: '{social_media_addresses}',
          educations: '{educations}',
          employments: '{employments}',
          tags: '{tags}',
          custom_fields: '{custom_fields}',
          applications: '{applications}',
          activity_feed_notes: '{activity_feed_notes}',
        },
      },
      // Greenhouse does not dedupe candidate POSTs; replay creates a
      // duplicate person record. Caller owns dedupe via the SDK's
      // idempotency key (email match before create is the typical pattern).
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'candidates.update',
      class: 'mutation',
      description:
        'Patch a Greenhouse candidate. Body is a partial Harvest candidate payload — only the fields you send are touched; arrays replace wholesale.',
      parameters: {
        type: 'object',
        properties: {
          candidateId: { type: 'integer' },
          onBehalfOf: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          addresses: { type: 'array', items: { type: 'object' } },
          email_addresses: { type: 'array', items: { type: 'object' } },
          website_addresses: { type: 'array', items: { type: 'object' } },
          social_media_addresses: { type: 'array', items: { type: 'object' } },
          tags: { type: 'array', items: { type: 'string' } },
          custom_fields: { type: 'object' },
        },
        required: ['candidateId', 'onBehalfOf'],
      },
      request: {
        method: 'PATCH',
        path: `/${GH_API_VERSION}/candidates/{candidateId}`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          company: '{company}',
          title: '{title}',
          phone_numbers: '{phone_numbers}',
          addresses: '{addresses}',
          email_addresses: '{email_addresses}',
          website_addresses: '{website_addresses}',
          social_media_addresses: '{social_media_addresses}',
          tags: '{tags}',
          custom_fields: '{custom_fields}',
        },
      },
      // Greenhouse PATCH is last-write-wins; no etag, no If-Match header.
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'candidates.anonymize',
      class: 'mutation',
      description:
        'GDPR/CCPA anonymize a candidate. Greenhouse permanently scrubs PII from the record; the action is irreversible.',
      parameters: {
        type: 'object',
        properties: {
          candidateId: { type: 'integer' },
          onBehalfOf: { type: 'string' },
          fields: {
            type: 'string',
            description: 'Comma-separated list of categories to scrub: `personal`, `application`, `referrer`. Defaults to all.',
          },
        },
        required: ['candidateId', 'onBehalfOf'],
      },
      request: {
        method: 'PUT',
        path: `/${GH_API_VERSION}/candidates/{candidateId}/anonymize`,
        query: { fields: '{fields}' },
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
      },
      // Already-anonymized candidates 200 with the same payload — safe to
      // replay.
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'applications.list',
      class: 'read',
      description:
        'List applications across the tenant. Filter by status (active, hired, rejected), job_id, candidate_id, or last_activity windows.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'hired', 'rejected', 'converted'] },
          job_id: { type: 'integer' },
          candidate_id: { type: 'integer' },
          last_activity_after: { type: 'string', format: 'date-time' },
          last_activity_before: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/applications`,
        query: {
          status: '{status}',
          job_id: '{job_id}',
          candidate_id: '{candidate_id}',
          last_activity_after: '{last_activity_after}',
          last_activity_before: '{last_activity_before}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'applications.get',
      class: 'read',
      description: 'Fetch a single Greenhouse application by id (includes current_stage, jobs[], rejection_reason, scorecards[]).',
      parameters: {
        type: 'object',
        properties: { applicationId: { type: 'integer' } },
        required: ['applicationId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/applications/{applicationId}` },
    },
    {
      name: 'applications.advance',
      class: 'mutation',
      description:
        'Advance an application to the next interview stage in its job kit. Body may carry `from_stage_id` for a safety check (Greenhouse rejects if the application has already moved).',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'integer' },
          onBehalfOf: { type: 'string' },
          from_stage_id: { type: 'integer' },
        },
        required: ['applicationId', 'onBehalfOf'],
      },
      request: {
        method: 'POST',
        path: `/${GH_API_VERSION}/applications/{applicationId}/advance`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: { from_stage_id: '{from_stage_id}' },
      },
      // Greenhouse advances by exactly one stage. Replay races: the second
      // call advances again (or 422s if the app is already in the final
      // stage). Caller owns dedupe; `from_stage_id` is the documented
      // safety check.
      cas: 'none',
      externalEffect: true,
    },
    {
      name: 'applications.reject',
      class: 'mutation',
      description:
        'Reject an application. Body carries rejection_reason (id) and optional rejection_email (subject, body, send_email_at).',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'integer' },
          onBehalfOf: { type: 'string' },
          rejection_reason: { type: 'object', description: '{ id: <rejectionReasonId> }' },
          notes: { type: 'string' },
          rejection_email: { type: 'object' },
        },
        required: ['applicationId', 'onBehalfOf'],
      },
      request: {
        method: 'POST',
        path: `/${GH_API_VERSION}/applications/{applicationId}/reject`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: {
          rejection_reason: '{rejection_reason}',
          notes: '{notes}',
          rejection_email: '{rejection_email}',
        },
      },
      // Re-rejecting an already-rejected application 422s; treat as
      // non-idempotent and let the caller do a status read first.
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'applications.hire',
      class: 'mutation',
      description:
        'Hire an application. Body carries start_date (ISO date) and opening_id (the job opening being filled). Greenhouse closes the opening on success.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'integer' },
          onBehalfOf: { type: 'string' },
          start_date: { type: 'string', format: 'date' },
          opening_id: { type: 'integer' },
          close_reason_id: { type: 'integer' },
        },
        required: ['applicationId', 'onBehalfOf', 'start_date', 'opening_id'],
      },
      request: {
        method: 'POST',
        path: `/${GH_API_VERSION}/applications/{applicationId}/hire`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: {
          start_date: '{start_date}',
          opening_id: '{opening_id}',
          close_reason_id: '{close_reason_id}',
        },
      },
      cas: 'optimistic-read-verify',
      externalEffect: true,
    },
    {
      name: 'jobs.list',
      class: 'read',
      description:
        'List jobs in the tenant. Filter by status (open, closed, draft), department_id, office_id, or created/updated windows.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'closed', 'draft'] },
          department_id: { type: 'integer' },
          office_id: { type: 'integer' },
          requisition_id: { type: 'string' },
          created_after: { type: 'string', format: 'date-time' },
          updated_after: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/jobs`,
        query: {
          status: '{status}',
          department_id: '{department_id}',
          office_id: '{office_id}',
          requisition_id: '{requisition_id}',
          created_after: '{created_after}',
          updated_after: '{updated_after}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'jobs.get',
      class: 'read',
      description: 'Fetch a single job by id (includes hiring_team, departments[], offices[], openings[], custom_fields).',
      parameters: {
        type: 'object',
        properties: { jobId: { type: 'integer' } },
        required: ['jobId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/jobs/{jobId}` },
    },
    {
      name: 'jobs.openings.list',
      class: 'read',
      description: 'List openings (requisitions) on a job. Each opening can be filled by exactly one application.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'integer' },
          status: { type: 'string', enum: ['open', 'closed'] },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
        required: ['jobId'],
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/jobs/{jobId}/openings`,
        query: { status: '{status}', page: '{page}', per_page: '{per_page}' },
      },
    },
    {
      name: 'users.list',
      class: 'read',
      description:
        'List Greenhouse users. Filter by email or updated_after. Use this to resolve the `onBehalfOf` id by email before mutations.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          updated_after: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/users`,
        query: {
          email: '{email}',
          updated_after: '{updated_after}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'users.get',
      class: 'read',
      description: 'Fetch a Greenhouse user by id (includes site_admin, employee_id, linked_candidate_ids).',
      parameters: {
        type: 'object',
        properties: { userId: { type: 'integer' } },
        required: ['userId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/users/{userId}` },
    },
    {
      name: 'offers.list',
      class: 'read',
      description: 'List offers, optionally scoped to an application or filtered by status (drafted, approved, sent, accepted, rejected).',
      parameters: {
        type: 'object',
        properties: {
          application_id: { type: 'integer' },
          status: { type: 'string', enum: ['drafted', 'approval-sent', 'approved', 'sent', 'sent-manually', 'accepted', 'rejected', 'deprecated'] },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/offers`,
        query: {
          application_id: '{application_id}',
          status: '{status}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'offers.get',
      class: 'read',
      description: 'Fetch a single offer by id (includes custom_fields, sent_at, resolved_at, opening, status).',
      parameters: {
        type: 'object',
        properties: { offerId: { type: 'integer' } },
        required: ['offerId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/offers/{offerId}` },
    },
    {
      name: 'scorecards.list',
      class: 'read',
      description: 'List scorecards, optionally scoped to an application. Includes interviewer, ratings, attributes, submitted_at.',
      parameters: {
        type: 'object',
        properties: {
          application_id: { type: 'integer' },
          updated_after: { type: 'string', format: 'date-time' },
          page: { type: 'integer', minimum: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 500 },
        },
      },
      request: {
        method: 'GET',
        path: `/${GH_API_VERSION}/scorecards`,
        query: {
          application_id: '{application_id}',
          updated_after: '{updated_after}',
          page: '{page}',
          per_page: '{per_page}',
        },
      },
    },
    {
      name: 'scorecards.get',
      class: 'read',
      description: 'Fetch a single scorecard by id.',
      parameters: {
        type: 'object',
        properties: { scorecardId: { type: 'integer' } },
        required: ['scorecardId'],
      },
      request: { method: 'GET', path: `/${GH_API_VERSION}/scorecards/{scorecardId}` },
    },
    {
      name: 'prospects.create',
      class: 'mutation',
      description:
        'Create a prospect (a candidate not yet attached to a specific application/job stage). Body is the Harvest prospect payload; same field set as candidates plus `prospect_pool` and `prospect_owner`.',
      parameters: {
        type: 'object',
        properties: {
          onBehalfOf: { type: 'string' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          company: { type: 'string' },
          title: { type: 'string' },
          email_addresses: { type: 'array', items: { type: 'object' } },
          phone_numbers: { type: 'array', items: { type: 'object' } },
          social_media_addresses: { type: 'array', items: { type: 'object' } },
          prospect_pool: { type: 'object', description: '{ id: <poolId> }' },
          prospect_stage: { type: 'object', description: '{ id: <stageId> }' },
          prospect_owner: { type: 'object', description: '{ id: <userId> }' },
          custom_fields: { type: 'object' },
          applications: { type: 'array', items: { type: 'object' } },
        },
        required: ['onBehalfOf', 'first_name', 'last_name'],
      },
      request: {
        method: 'POST',
        path: `/${GH_API_VERSION}/prospects`,
        headers: { 'On-Behalf-Of': '{onBehalfOf}' },
        body: {
          first_name: '{first_name}',
          last_name: '{last_name}',
          company: '{company}',
          title: '{title}',
          email_addresses: '{email_addresses}',
          phone_numbers: '{phone_numbers}',
          social_media_addresses: '{social_media_addresses}',
          prospect_pool: '{prospect_pool}',
          prospect_stage: '{prospect_stage}',
          prospect_owner: '{prospect_owner}',
          custom_fields: '{custom_fields}',
          applications: '{applications}',
        },
      },
      // Same dedupe story as candidates.create — Greenhouse does not match
      // on email server-side.
      cas: 'none',
      externalEffect: true,
    },
  ],
})
