import { declarativeRestConnector } from './declarative-rest.js'

export const workableConnector = declarativeRestConnector({
  kind: 'workable',
  displayName: 'Workable',
  description: 'Access candidate records, jobs, stages, and team members in Workable. Move candidates between pipeline stages and rate candidates.',
  auth: { kind: 'api-key', hint: 'Workable API token.' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.workable.com/v1',
  test: { method: 'GET', path: '/jobs' },
  capabilities: [
    {
      name: 'candidates.get',
      class: 'read',
      description: 'Retrieve a specific candidate by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
        },
        required: ['id'],
      },
      request: { method: 'GET', path: '/candidates/{id}' },
    },
    {
      name: 'jobs.get',
      class: 'read',
      description: 'Retrieve a specific job by shortcode.',
      parameters: {
        type: 'object',
        properties: {
          shortcode: { type: 'string', description: 'Job shortcode' },
        },
        required: ['shortcode'],
      },
      request: { method: 'GET', path: '/jobs/{shortcode}' },
    },
    {
      name: 'jobs.stages',
      class: 'read',
      description: 'List all hiring pipeline stages for a job.',
      parameters: {
        type: 'object',
        properties: {
          shortcode: { type: 'string', description: 'Job shortcode' },
        },
        required: ['shortcode'],
      },
      request: { method: 'GET', path: '/jobs/{shortcode}/stages' },
    },
    {
      name: 'jobs.list',
      class: 'read',
      description: 'List all jobs.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Number of results to return' },
        },
        required: [],
      },
      request: { method: 'GET', path: '/jobs', query: { limit: '{limit}' } },
    },
    {
      name: 'members.list',
      class: 'read',
      description: 'List team members.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', description: 'Filter by member role' },
          email: { type: 'string', description: 'Filter by member email' },
          name: { type: 'string', description: 'Filter by member name (exact match)' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/members',
        query: { role: '{role}', email: '{email}', name: '{name}' },
      },
    },
    {
      name: 'candidates.move',
      class: 'mutation',
      description: 'Move a candidate to a different pipeline stage.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
          target_stage: { type: 'string', description: 'Target stage slug' },
        },
        required: ['id', 'target_stage'],
      },
      request: {
        method: 'PUT',
        path: '/candidates/{id}',
        body: { stage: '{target_stage}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'candidates.rate',
      class: 'mutation',
      description: 'Rate a candidate on a scale.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
          scale: { type: 'string', description: 'Rating scale (e.g., thumbs, stars, numbers)' },
          grade: { type: 'integer', description: 'Grade value' },
          comment: { type: 'string', description: 'Rating comment' },
        },
        required: ['id', 'scale', 'grade', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/candidates/{id}/ratings',
        body: { scale: '{scale}', grade: '{grade}', comment: '{comment}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'candidates.comment',
      class: 'mutation',
      description: 'Add a comment to a candidate record.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
          comment: { type: 'string', description: 'Comment text' },
        },
        required: ['id', 'comment'],
      },
      request: {
        method: 'POST',
        path: '/candidates/{id}/comments',
        body: { body: '{comment}' },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'candidates.create',
      class: 'mutation',
      description: 'Create a candidate on a job.',
      parameters: {
        type: 'object',
        properties: {
          shortcode: { type: 'string', description: 'Job shortcode the candidate applies to.' },
          candidate: {
            type: 'object',
            description: 'Candidate payload (name, email, headline, summary, etc.).',
          },
        },
        required: ['shortcode', 'candidate'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{shortcode}/candidates',
        body: { candidate: '{candidate}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'candidates.disqualify',
      class: 'mutation',
      description: 'Disqualify a candidate.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
          disqualification_reason_id: {
            type: 'string',
            description: 'Optional disqualification reason ID.',
          },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/candidates/{id}/disqualify',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'candidates.revert',
      class: 'mutation',
      description: 'Revert a disqualified candidate.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
        },
        required: ['id'],
      },
      request: {
        method: 'POST',
        path: '/candidates/{id}/revert',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'jobs.publish',
      class: 'mutation',
      description: 'Publish a job opening.',
      parameters: {
        type: 'object',
        properties: {
          shortcode: { type: 'string', description: 'Job shortcode' },
        },
        required: ['shortcode'],
      },
      request: {
        method: 'POST',
        path: '/jobs/{shortcode}/publish',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'offers.create',
      class: 'mutation',
      description: 'Create an offer for a candidate.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Candidate ID' },
          offer: {
            type: 'object',
            description: 'Offer payload (starts_on, salary, currency, employment_type, etc.).',
          },
        },
        required: ['id', 'offer'],
      },
      request: {
        method: 'POST',
        path: '/candidates/{id}/offer',
        body: { offer: '{offer}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
