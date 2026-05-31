import { declarativeRestConnector } from './declarative-rest.js'

export const tlDvConnector = declarativeRestConnector({
  kind: 'tl-dv',
  displayName: 'tl;dv',
  description: 'Record meetings, get transcripts, and access meeting notes automatically.',
  auth: { kind: 'api-key', hint: 'tl;dv API key.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.tldv.io/v1',
  test: { method: 'GET', path: '/meetings' },
  capabilities: [
    {
      name: 'meetings.list',
      class: 'read',
      description: 'List meetings with optional search and filtering.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
          onlyParticipated: { type: 'boolean' },
          meetingType: { type: 'string' },
        },
      },
      request: {
        method: 'GET',
        path: '/meetings',
        query: {
          query: '{query}',
          page: '{page}',
          limit: '{limit}',
          onlyParticipated: '{onlyParticipated}',
          meetingType: '{meetingType}',
        },
      },
    },
    {
      name: 'meetings.get',
      class: 'read',
      description: 'Get details of a specific meeting.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}' },
    },
    {
      name: 'meetings.upload',
      class: 'mutation',
      description: 'Upload a recording for transcription.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          happenedAt: { type: 'string' },
          dryRun: { type: 'boolean' },
          participants: { type: 'object' },
        },
        required: ['name', 'url'],
      },
      request: {
        method: 'POST',
        path: '/meetings/upload',
        body: {
          name: '{name}',
          url: '{url}',
          happenedAt: '{happenedAt}',
          dryRun: '{dryRun}',
          participants: '{participants}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'transcripts.get',
      class: 'read',
      description: 'Get the transcript of a meeting.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}/transcript' },
    },
    {
      name: 'highlights.get',
      class: 'read',
      description: 'Get highlights from a meeting.',
      parameters: {
        type: 'object',
        properties: { meetingId: { type: 'string' } },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}/highlights' },
    },
  ],
})
