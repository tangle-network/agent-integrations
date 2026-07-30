import { declarativeRestConnector } from './declarative-rest.js'

// MeetGeek is an AI meeting assistant. The public API is REST/JSON at
// https://api.meetgeek.ai/v1 and is authenticated with an API key carried in
// the `Authorization: Bearer <key>` header. Docs: https://docs.meetgeek.ai/.
//
// The catalog enumerates six actions (Get Highlights, Get Meeting Details,
// Get Meeting Summary & AI Insights, Get Team Meetings, Get Transcript,
// Upload Recording). Each route below matches MeetGeek's published client.

export const meetgeekAiConnector = declarativeRestConnector({
  kind: 'meetgeek-ai',
  displayName: 'MeetGeek',
  description:
    'AI meeting assistant: list and inspect recorded meetings, pull transcripts, highlights, and summary insights, and upload new recordings for transcription.',
  auth: {
    kind: 'api-key',
    hint: 'MeetGeek API key — sent as `Authorization: Bearer <key>` against https://api.meetgeek.ai/v1.',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.meetgeek.ai/v1',
  test: { method: 'GET', path: '/teams' },
  capabilities: [
    {
      name: 'meetings.list',
      class: 'read',
      description: 'List past meetings belonging to a MeetGeek team.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'MeetGeek team id.' },
        },
        required: ['teamId'],
      },
      request: { method: 'GET', path: '/teams/{teamId}/meetings' },
    },
    {
      name: 'meetings.get',
      class: 'read',
      description: 'Return metadata for a single meeting by id (participants, host, duration, summary).',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'The MeetGeek meeting id.' },
        },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}' },
    },
    {
      name: 'meetings.transcript',
      class: 'read',
      description:
        'Return the time-coded transcript for a meeting. The response is an array of utterances with speaker, start/end offsets, and text.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'The MeetGeek meeting id.' },
        },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}/transcript' },
    },
    {
      name: 'meetings.highlights',
      class: 'read',
      description:
        'Return the AI-generated highlights (key moments, action items, decisions) for a single meeting.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'The MeetGeek meeting id.' },
        },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}/highlights' },
    },
    {
      name: 'meetings.summaryInsights',
      class: 'read',
      description: 'Return the summary and AI-generated insights for one MeetGeek meeting.',
      parameters: {
        type: 'object',
        properties: {
          meetingId: { type: 'string', description: 'The MeetGeek meeting id.' },
        },
        required: ['meetingId'],
      },
      request: { method: 'GET', path: '/meetings/{meetingId}/summary' },
    },
    {
      name: 'recordings.upload',
      class: 'mutation',
      description:
        'Submit a recording for asynchronous transcription. MeetGeek fetches `downloadUrl` directly, so the URL must be publicly reachable (e.g. an S3 signed link). The response carries the queued meeting id you can poll via `meetings.get`.',
      parameters: {
        type: 'object',
        properties: {
          downloadUrl: {
            type: 'string',
            description:
              'Publicly reachable URL MeetGeek will GET to fetch the audio/video file. Required.',
          },
          languageCode: {
            type: 'string',
            description: 'BCP-47 language code (e.g. en-US, es-ES, fr-FR).',
          },
          templateName: {
            type: 'string',
            description: 'Optional MeetGeek meeting template name used to drive analysis.',
          },
        },
        required: ['downloadUrl'],
      },
      request: {
        method: 'POST',
        path: '/upload',
        body: {
          download_url: '{downloadUrl}',
          language_code: '{languageCode}',
          template_name: '{templateName}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
