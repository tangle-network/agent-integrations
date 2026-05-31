import { declarativeRestConnector } from './declarative-rest.js'

// MeetGeek is an AI meeting assistant. The public API is REST/JSON at
// https://api.meetgeek.ai/v1 and is authenticated with an API key carried in
// the `Authorization: Bearer <key>` header. Docs: https://docs.meetgeek.ai/.
//
// The activepieces catalog enumerates six actions (Get Highlights, Get
// Meeting Details, Get Meetings Summary Insights, Get Team Meetings, Get
// Transcript, Upload Recording). We map each to its documented REST route.
// `meetings.list` is the catalog's `get.team.meetings` — MeetGeek exposes a
// single tenant scope per API key so "team meetings" is just the list route.

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
  test: { method: 'GET', path: '/meetings', query: { limit: 1 } },
  capabilities: [
    {
      name: 'meetings.list',
      class: 'read',
      description:
        'List meetings recorded on the authenticated workspace. Supports pagination via cursor and date filters.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Page size (max 100).',
          },
          cursor: { type: 'string', description: 'Opaque pagination cursor returned by a prior call.' },
          fromDate: {
            type: 'string',
            description: 'Inclusive lower bound for meeting start (ISO 8601).',
          },
          toDate: {
            type: 'string',
            description: 'Inclusive upper bound for meeting start (ISO 8601).',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/meetings',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
          from_date: '{fromDate}',
          to_date: '{toDate}',
        },
      },
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
      description:
        'Return aggregate summary insights across a window of meetings (topics, sentiment, attendance, talk ratio).',
      parameters: {
        type: 'object',
        properties: {
          fromDate: {
            type: 'string',
            description: 'Inclusive lower bound for the analysis window (ISO 8601).',
          },
          toDate: {
            type: 'string',
            description: 'Inclusive upper bound for the analysis window (ISO 8601).',
          },
          templateName: {
            type: 'string',
            description:
              'Optional MeetGeek meeting template (e.g. Sales Discovery, 1-on-1). Filters insights to meetings tagged with the template.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/insights/summary',
        query: {
          from_date: '{fromDate}',
          to_date: '{toDate}',
          template_name: '{templateName}',
        },
      },
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
          instruction: {
            type: 'string',
            description: 'Free-form instruction passed to MeetGeek for custom summarization.',
          },
        },
        required: ['downloadUrl'],
      },
      request: {
        method: 'POST',
        path: '/recordings',
        body: {
          download_url: '{downloadUrl}',
          language_code: '{languageCode}',
          template_name: '{templateName}',
          instruction: '{instruction}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
