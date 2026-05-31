import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Google Meet REST API v2 (GA) — Bearer OAuth2 against meet.googleapis.com.
 *
 * Google Meet exposes two surfaces over OAuth:
 *
 *   1. spaces — the lobby/room resource. `spaces.create` returns a fresh
 *      `meet.google.com/<code>` URL the agent can hand to attendees;
 *      `spaces.get` / `spaces.patch` read and mutate the AccessType,
 *      EntryPointAccess, recording config, and chat/restriction toggles.
 *      `spaces.endActiveConference` force-terminates the in-progress
 *      conference inside the space (idempotent at upstream).
 *
 *   2. conferenceRecords — read-only post-meeting artifacts. Conference
 *      records are emitted ~minutes after a meeting ends, and expose
 *      child collections for participants, recordings, and transcripts.
 *      `recordings` and `transcripts` link out to Drive files; consumers
 *      that want to download those artifacts also need a Drive scope.
 *
 * Scopes follow Google's documented Meet OAuth ladder:
 *   - meetings.space.created     — manage spaces this OAuth app created
 *   - meetings.space.readonly    — read any space the user can access
 *   - meetings.space.settings    — mutate space settings
 * Plus `drive.readonly` so a downstream caller can fetch recording /
 * transcript files referenced from conferenceRecords.
 *
 * See https://developers.google.com/meet/api/reference/rest .
 */
export const googleMeetConnector = declarativeRestConnector({
  kind: 'google-meet',
  displayName: 'Google Meet',
  description:
    'Create Google Meet spaces, fetch post-meeting conference records, and read participants, recordings, and transcripts via the Google Meet REST API v2.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: [
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
      'https://www.googleapis.com/auth/meetings.space.settings',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
  },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://meet.googleapis.com',
  // /v2/spaces/{name} requires a real space id; the cheapest token-validity
  // probe Meet exposes is creating a throwaway space, which has a side effect
  // we don't want in a connection test. Skip the in-band test — the adapter
  // contract treats a missing `test` as ok and connection issuance still
  // catches the auth handshake at exchange time.
  capabilities: [
    {
      name: 'spaces.create',
      class: 'mutation',
      description:
        'Create a Meet space and return its meet.google.com URL. The space lives until the calling user deletes it or it expires per Google retention rules.',
      parameters: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            description:
              'Optional SpaceConfig: accessType (OPEN | TRUSTED | RESTRICTED), entryPointAccess (ALL | CREATOR_APP_ONLY), moderation, attendanceReport, artifactConfig, chatRestriction, presentRestriction, defaultJoinAsViewerType.',
          },
        },
      },
      request: {
        method: 'POST',
        path: '/v2/spaces',
        body: {
          config: '{config}',
        },
      },
      // Meet's spaces.create is a pure side-effect; no upstream idempotency
      // key on this endpoint, so a retry produces a second space. Mark
      // accordingly so the MutationGuard layer enforces idempotency.
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.created'],
    },
    {
      name: 'spaces.get',
      class: 'read',
      description:
        'Read a Meet space by resource name (e.g. "spaces/abc-defg-hij") or by short meeting code.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Resource name like "spaces/{space_id}" or "spaces/{meeting_code}".',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'GET',
        path: '/v2/{name}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'spaces.update',
      class: 'mutation',
      description:
        'Patch a Meet space (accessType, entryPointAccess, moderation toggles, artifactConfig, chat/present restrictions). Caller supplies updateMask to specify mutated fields.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Resource name like "spaces/{space_id}".' },
          updateMask: {
            type: 'string',
            description: 'Comma-separated FieldMask of mutated fields, e.g. "config.accessType,config.moderation".',
          },
          config: { type: 'object', description: 'New SpaceConfig values.' },
        },
        required: ['name'],
      },
      request: {
        method: 'PATCH',
        path: '/v2/{name}',
        query: {
          updateMask: '{updateMask}',
        },
        body: {
          config: '{config}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.settings'],
    },
    {
      name: 'spaces.endActiveConference',
      class: 'mutation',
      description:
        'Terminate the currently active conference inside a Meet space. No-op (HTTP 200) if no conference is active.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Resource name like "spaces/{space_id}".' },
        },
        required: ['name'],
      },
      request: {
        method: 'POST',
        path: '/v2/{name}:endActiveConference',
        body: {},
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.created'],
    },
    {
      name: 'conferenceRecords.list',
      class: 'read',
      description:
        'List conference records for meetings the calling user attended or hosted. Supports server-side filtering by space.name and end_time.',
      parameters: {
        type: 'object',
        properties: {
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
          filter: {
            type: 'string',
            description: 'EBNF filter, e.g. \'space.name="spaces/abc"\' or \'end_time>="2024-01-01T00:00:00Z"\'.',
          },
        },
      },
      request: {
        method: 'GET',
        path: '/v2/conferenceRecords',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          filter: '{filter}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.get',
      class: 'read',
      description: 'Read a conference record by resource name (e.g. "conferenceRecords/abc123").',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Resource name like "conferenceRecords/{conference_record_id}".' },
        },
        required: ['name'],
      },
      request: {
        method: 'GET',
        path: '/v2/{name}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.participants.list',
      class: 'read',
      description: 'List participants for a finished conference, including anonymous and phone-dial-in attendees.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Parent conferenceRecords/{conference_record_id}.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 250 },
          pageToken: { type: 'string' },
          filter: { type: 'string', description: 'EBNF filter, e.g. \'earliest_start_time<="2024-01-01T00:00:00Z"\'.' },
        },
        required: ['parent'],
      },
      request: {
        method: 'GET',
        path: '/v2/{parent}/participants',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
          filter: '{filter}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.recordings.list',
      class: 'read',
      description:
        'List recordings for a conference record. Each entry includes the Drive file id and DriveFileExportUri for downstream Drive fetches.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Parent conferenceRecords/{conference_record_id}.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
        required: ['parent'],
      },
      request: {
        method: 'GET',
        path: '/v2/{parent}/recordings',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.recordings.get',
      class: 'read',
      description: 'Read a single recording by resource name.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Resource name like "conferenceRecords/{conference_record_id}/recordings/{recording_id}".',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'GET',
        path: '/v2/{name}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.transcripts.list',
      class: 'read',
      description: 'List transcripts (auto-generated captions exports) for a conference record.',
      parameters: {
        type: 'object',
        properties: {
          parent: { type: 'string', description: 'Parent conferenceRecords/{conference_record_id}.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          pageToken: { type: 'string' },
        },
        required: ['parent'],
      },
      request: {
        method: 'GET',
        path: '/v2/{parent}/transcripts',
        query: {
          pageSize: '{pageSize}',
          pageToken: '{pageToken}',
        },
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
    {
      name: 'conferenceRecords.transcripts.get',
      class: 'read',
      description: 'Read a transcript by resource name; payload links to the Drive Doc holding the transcript text.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Resource name like "conferenceRecords/{conference_record_id}/transcripts/{transcript_id}".',
          },
        },
        required: ['name'],
      },
      request: {
        method: 'GET',
        path: '/v2/{name}',
      },
      requiredScopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
    },
  ],
})
