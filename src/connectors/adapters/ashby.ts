import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Ashby ATS (https://developers.ashbyhq.com).
 *
 * Auth: HTTP Basic with the API key as the username and an empty password.
 * The catalog entry lists no explicit actions, so the surface below maps the
 * documented public API resources (candidate, job, application, offer,
 * feedback, interview, interviewSchedule). All Ashby endpoints are HTTP POST
 * with a JSON body — there are no GET reads — so query-class capabilities
 * model `*.list` / `*.info` calls as POSTs with a body envelope.
 */
export const ashbyConnector = declarativeRestConnector({
  kind: 'ashby',
  displayName: 'Ashby',
  description: 'Read and mutate Ashby ATS candidates, jobs, applications, offers, feedback, and interview schedules.',
  auth: {
    kind: 'api-key',
    hint: 'Ashby API key. Sent as the username in HTTP Basic auth with an empty password (base64-encode "<apiKey>:" for the Authorization header).',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.ashbyhq.com',
  credentialPlacement: { kind: 'header', header: 'Authorization', prefix: 'Basic ' },
  defaultHeaders: { 'Content-Type': 'application/json', Accept: 'application/json' },
  test: { method: 'POST', path: '/apiKey.info', body: {} },
  capabilities: [
    {
      name: 'candidates.list',
      class: 'read',
      description: 'List candidates with optional cursor pagination and updatedAt filtering.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          syncToken: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'POST',
        path: '/candidate.list',
        body: { cursor: '{cursor}', syncToken: '{syncToken}', limit: '{limit}' },
      },
    },
    {
      name: 'candidates.info',
      class: 'read',
      description: 'Fetch a single candidate by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'POST', path: '/candidate.info', body: { id: '{id}' } },
    },
    {
      name: 'candidates.search',
      class: 'read',
      description: 'Search candidates by email or name.',
      parameters: {
        type: 'object',
        properties: { email: { type: 'string' }, name: { type: 'string' } },
      },
      request: {
        method: 'POST',
        path: '/candidate.search',
        body: { email: '{email}', name: '{name}' },
      },
    },
    {
      name: 'candidates.create',
      class: 'mutation',
      description: 'Create an Ashby candidate.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phoneNumber: { type: 'string' },
          linkedInUrl: { type: 'string' },
          githubUrl: { type: 'string' },
          website: { type: 'string' },
          location: { type: 'object' },
          createdAt: { type: 'string' },
          sourceId: { type: 'string' },
          credentedSourceTypeId: { type: 'string' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/candidate.create',
        body: {
          name: '{name}',
          email: '{email}',
          phoneNumber: '{phoneNumber}',
          linkedInUrl: '{linkedInUrl}',
          githubUrl: '{githubUrl}',
          website: '{website}',
          location: '{location}',
          createdAt: '{createdAt}',
          sourceId: '{sourceId}',
          credentedSourceTypeId: '{credentedSourceTypeId}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'candidates.update',
      class: 'mutation',
      description: 'Update an existing candidate.',
      parameters: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          phoneNumber: { type: 'string' },
          linkedInUrl: { type: 'string' },
          githubUrl: { type: 'string' },
          website: { type: 'string' },
          location: { type: 'object' },
        },
        required: ['candidateId'],
      },
      request: {
        method: 'POST',
        path: '/candidate.update',
        body: {
          candidateId: '{candidateId}',
          name: '{name}',
          email: '{email}',
          phoneNumber: '{phoneNumber}',
          linkedInUrl: '{linkedInUrl}',
          githubUrl: '{githubUrl}',
          website: '{website}',
          location: '{location}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'candidates.addTag',
      class: 'mutation',
      description: 'Attach a tag to a candidate.',
      parameters: {
        type: 'object',
        properties: { candidateId: { type: 'string' }, tagId: { type: 'string' } },
        required: ['candidateId', 'tagId'],
      },
      request: {
        method: 'POST',
        path: '/candidate.addTag',
        body: { candidateId: '{candidateId}', tagId: '{tagId}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'jobs.list',
      class: 'read',
      description: 'List open and closed jobs.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          syncToken: { type: 'string' },
          limit: { type: 'integer' },
          status: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/job.list',
        body: {
          cursor: '{cursor}',
          syncToken: '{syncToken}',
          limit: '{limit}',
          status: '{status}',
        },
      },
    },
    {
      name: 'jobs.info',
      class: 'read',
      description: 'Fetch a single job by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      request: { method: 'POST', path: '/job.info', body: { id: '{id}' } },
    },
    {
      name: 'applications.list',
      class: 'read',
      description: 'List applications.',
      parameters: {
        type: 'object',
        properties: {
          cursor: { type: 'string' },
          syncToken: { type: 'string' },
          limit: { type: 'integer' },
          status: { type: 'string' },
          jobId: { type: 'string' },
        },
      },
      request: {
        method: 'POST',
        path: '/application.list',
        body: {
          cursor: '{cursor}',
          syncToken: '{syncToken}',
          limit: '{limit}',
          status: '{status}',
          jobId: '{jobId}',
        },
      },
    },
    {
      name: 'applications.info',
      class: 'read',
      description: 'Fetch a single application.',
      parameters: {
        type: 'object',
        properties: { applicationId: { type: 'string' } },
        required: ['applicationId'],
      },
      request: {
        method: 'POST',
        path: '/application.info',
        body: { applicationId: '{applicationId}' },
      },
    },
    {
      name: 'applications.create',
      class: 'mutation',
      description: 'Create a new application linking a candidate to a job.',
      parameters: {
        type: 'object',
        properties: {
          candidateId: { type: 'string' },
          jobId: { type: 'string' },
          interviewPlanId: { type: 'string' },
          interviewStageId: { type: 'string' },
          sourceId: { type: 'string' },
          credentedSourceTypeId: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['candidateId', 'jobId'],
      },
      request: {
        method: 'POST',
        path: '/application.create',
        body: {
          candidateId: '{candidateId}',
          jobId: '{jobId}',
          interviewPlanId: '{interviewPlanId}',
          interviewStageId: '{interviewStageId}',
          sourceId: '{sourceId}',
          credentedSourceTypeId: '{credentedSourceTypeId}',
          createdAt: '{createdAt}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'applications.changeStage',
      class: 'mutation',
      description: 'Advance or move an application to a new interview stage.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
          interviewStageId: { type: 'string' },
          archiveReasonId: { type: 'string' },
        },
        required: ['applicationId', 'interviewStageId'],
      },
      request: {
        method: 'POST',
        path: '/application.changeStage',
        body: {
          applicationId: '{applicationId}',
          interviewStageId: '{interviewStageId}',
          archiveReasonId: '{archiveReasonId}',
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'offers.list',
      class: 'read',
      description: 'List offers, optionally filtered by application.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
          cursor: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'POST',
        path: '/offer.list',
        body: {
          applicationId: '{applicationId}',
          cursor: '{cursor}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'offers.info',
      class: 'read',
      description: 'Fetch a single offer with version history.',
      parameters: {
        type: 'object',
        properties: { offerId: { type: 'string' } },
        required: ['offerId'],
      },
      request: { method: 'POST', path: '/offer.info', body: { offerId: '{offerId}' } },
    },
    {
      name: 'feedback.list',
      class: 'read',
      description: 'List submitted interview feedback for an application.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
          cursor: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'POST',
        path: '/applicationFeedback.list',
        body: {
          applicationId: '{applicationId}',
          cursor: '{cursor}',
          limit: '{limit}',
        },
      },
    },
    {
      name: 'interviews.scheduleList',
      class: 'read',
      description: 'List scheduled interviews.',
      parameters: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
          cursor: { type: 'string' },
          limit: { type: 'integer' },
        },
      },
      request: {
        method: 'POST',
        path: '/interviewSchedule.list',
        body: {
          applicationId: '{applicationId}',
          cursor: '{cursor}',
          limit: '{limit}',
        },
      },
    },
  ],
})
