import { declarativeRestConnector } from './declarative-rest.js'

// Fathom is an AI meeting assistant: it records, transcribes, and summarises
// calls, then exposes meeting metadata, summaries, and transcripts plus team
// directory lookups behind a single OAuth2-authenticated REST API rooted at
// `api.fathom.video`. All read operations here mirror the activepieces piece
// surface; there is no public mutation API for meetings (recordings are
// produced by the desktop / browser capture client, not pushed via REST), so
// the adapter is read-only by design.
export const fathomConnector = declarativeRestConnector({
  kind: 'fathom',
  displayName: 'Fathom',
  description:
    'Read Fathom meeting recordings, AI-generated summaries, transcripts, and team directory entries.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://fathom.video/oauth/authorize',
    tokenUrl: 'https://fathom.video/oauth/token',
    scopes: ['read:meetings', 'read:recordings', 'read:team'],
    clientIdEnv: 'FATHOM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'FATHOM_OAUTH_CLIENT_SECRET',
  },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.fathom.video',
  test: { method: 'GET', path: '/external/v1/meetings', query: { limit: 1 } },
  capabilities: [
    {
      name: 'recordings.summary.get',
      class: 'read',
      description:
        'Fetch the AI-generated summary, highlights, and action items for a single recording.',
      parameters: {
        type: 'object',
        properties: {
          recordingId: {
            type: 'string',
            description: 'Recording identifier returned by listMeetings or the new-recording trigger.',
          },
        },
        required: ['recordingId'],
      },
      request: {
        method: 'GET',
        path: '/external/v1/recordings/{recordingId}/summary',
      },
      requiredScopes: ['read:recordings'],
    },
    {
      name: 'recordings.transcript.get',
      class: 'read',
      description: 'Fetch the full speaker-attributed transcript for a single recording.',
      parameters: {
        type: 'object',
        properties: {
          recordingId: { type: 'string' },
          format: {
            type: 'string',
            enum: ['json', 'text', 'vtt'],
            description: 'Transcript serialisation format. Defaults to json when omitted.',
          },
        },
        required: ['recordingId'],
      },
      request: {
        method: 'GET',
        path: '/external/v1/recordings/{recordingId}/transcript',
        query: { format: '{format}' },
      },
      requiredScopes: ['read:recordings'],
    },
    {
      name: 'meetings.list',
      class: 'read',
      description:
        'List meetings the authenticated workspace has access to. Supports paging and a date-range filter.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string', description: 'Opaque pagination cursor returned by a previous page.' },
          startedAfter: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return meetings that started at or after this instant.',
          },
          startedBefore: {
            type: 'string',
            description: 'ISO-8601 timestamp; only return meetings that started at or before this instant.',
          },
          teamId: { type: 'string', description: 'Scope the listing to a specific Fathom team.' },
        },
      },
      request: {
        method: 'GET',
        path: '/external/v1/meetings',
        query: {
          limit: '{limit}',
          cursor: '{cursor}',
          started_after: '{startedAfter}',
          started_before: '{startedBefore}',
          team_id: '{teamId}',
        },
      },
      requiredScopes: ['read:meetings'],
    },
    {
      name: 'team.find',
      class: 'read',
      description: 'Look up a Fathom team by id or slug. Returns the team record plus member count.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Fathom team id; mutually exclusive with slug.' },
          slug: { type: 'string', description: 'Fathom team slug; mutually exclusive with teamId.' },
        },
      },
      request: {
        method: 'GET',
        path: '/external/v1/teams/{teamId}',
        query: { slug: '{slug}' },
      },
      requiredScopes: ['read:team'],
    },
    {
      name: 'team.member.find',
      class: 'read',
      description:
        'Look up a single team member by id or by email. Used to resolve attendees back to the workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Team the member belongs to.' },
          memberId: { type: 'string', description: 'Fathom member id; mutually exclusive with email.' },
          email: { type: 'string', description: 'Email of the member; mutually exclusive with memberId.' },
        },
        required: ['teamId'],
      },
      request: {
        method: 'GET',
        path: '/external/v1/teams/{teamId}/members/{memberId}',
        query: { email: '{email}' },
      },
      requiredScopes: ['read:team'],
    },
  ],
})
