import { declarativeRestConnector } from './declarative-rest.js'

/** tl;dv's public API is served from pasta.tldv.io under /v1alpha1 and uses
 * an x-api-key header. Keep this surface aligned with the five published
 * actions; unlisted write routes are not part of the public contract. */
export const tlDvConnector = declarativeRestConnector({
  kind: 'tl-dv',
  displayName: 'tl;dv',
  description: 'List meetings, retrieve transcripts and highlights, and import recordings for transcription.',
  auth: { kind: 'api-key', hint: 'tl;dv API key sent in the x-api-key header.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://pasta.tldv.io',
  credentialPlacement: { kind: 'header', header: 'x-api-key' },
  test: { method: 'GET', path: '/v1alpha1/health' },
  capabilities: [
    {
      name: 'meetings.list',
      class: 'read',
      description: 'Search and list tl;dv meetings with pagination, date, participation, and meeting-type filters.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
          from: { type: 'string', description: 'ISO-8601 lower bound.' },
          to: { type: 'string', description: 'ISO-8601 upper bound.' },
          onlyParticipated: { type: 'boolean' },
          meetingType: { type: 'string', enum: ['internal', 'external'] },
        },
      },
      request: {
        method: 'GET',
        path: '/v1alpha1/meetings',
        query: {
          query: '{query}',
          page: '{page}',
          limit: '{limit}',
          from: '{from}',
          to: '{to}',
          onlyParticipated: '{onlyParticipated}',
          meetingType: '{meetingType}',
        },
      },
    },
    {
      name: 'meetings.get',
      class: 'read',
      description: 'Get metadata for a tl;dv meeting by id.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/v1alpha1/meetings/{meetingId}' },
    },
    {
      name: 'meetings.upload',
      class: 'mutation',
      description: 'Import a publicly reachable audio or video recording for asynchronous processing.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          happenedAt: { type: 'string' },
          dryRun: { type: 'boolean' },
          participants: {
            type: 'array',
            items: { type: 'string', description: 'Participant email address.' },
          },
        },
        required: ['name', 'url'],
      },
      request: {
        method: 'POST',
        path: '/v1alpha1/meetings/import',
        body: {
          name: '{name}',
          url: '{url}',
          happenedAt: '{happenedAt}',
          dryRun: '{dryRun}',
          participants: '{participants}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'transcripts.get',
      class: 'read',
      description: 'Get the speaker-attributed transcript for a tl;dv meeting.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/v1alpha1/meetings/{meetingId}/transcript' },
    },
    {
      name: 'highlights.get',
      class: 'read',
      description: 'Get highlights and notes for a tl;dv meeting.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/v1alpha1/meetings/{meetingId}/highlights' },
    },
  ],
})
