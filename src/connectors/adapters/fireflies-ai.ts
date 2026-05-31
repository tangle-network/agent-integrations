import { declarativeRestConnector } from './declarative-rest.js'

// Fireflies.ai exposes a single GraphQL endpoint at https://api.fireflies.ai/graphql.
// We model each high-level action as a POST to /graphql with a fixed query string
// and a templated `variables` payload, so the declarative-REST runtime can dispatch
// every capability without a GraphQL-specific client. Callers supply GraphQL
// variables as a single `variables` object that the renderer substitutes verbatim
// into the request body.
//
// Auth: API key (Bearer). Docs: https://docs.fireflies.ai/

const TRANSCRIPT_FRAGMENT = `
  id
  title
  date
  duration
  host_email
  organizer_email
  participants
  transcript_url
  meeting_link
  summary { keywords action_items overview shorthand_bullet bullet_gist gist short_summary short_overview meeting_type topics_discussed }
`

const USER_FRAGMENT = `
  user_id
  email
  name
  num_transcripts
  recent_meeting
  minutes_consumed
  is_admin
  integrations
`

const FIND_MEETING_BY_ID_QUERY = `
  query TranscriptById($transcriptId: String!) {
    transcript(id: $transcriptId) {${TRANSCRIPT_FRAGMENT}}
  }
`

const FIND_RECENT_MEETING_QUERY = `
  query RecentTranscripts($limit: Int) {
    transcripts(limit: $limit) {${TRANSCRIPT_FRAGMENT}}
  }
`

const FIND_MEETING_BY_QUERY_QUERY = `
  query SearchTranscripts(
    $title: String
    $hostEmail: String
    $participantEmail: String
    $fromDate: DateTime
    $toDate: DateTime
    $limit: Int
  ) {
    transcripts(
      title: $title
      host_email: $hostEmail
      participant_email: $participantEmail
      fromDate: $fromDate
      toDate: $toDate
      limit: $limit
    ) {${TRANSCRIPT_FRAGMENT}}
  }
`

const UPLOAD_AUDIO_MUTATION = `
  mutation UploadAudio($input: AudioUploadInput!) {
    uploadAudio(input: $input) {
      success
      title
      message
    }
  }
`

const GET_USER_DETAILS_QUERY = `
  query UserDetails($userId: String) {
    user(id: $userId) {${USER_FRAGMENT}}
  }
`

const VIEWER_QUERY = `query Viewer { user { user_id email name } }`

export const firefliesAiConnector = declarativeRestConnector({
  kind: 'fireflies-ai',
  displayName: 'Fireflies.ai',
  description:
    'Meeting assistant that automatically records, transcribes, and analyzes conversations via the Fireflies.ai GraphQL API.',
  auth: {
    kind: 'api-key',
    hint: 'Fireflies.ai API key — sent as `Authorization: Bearer <key>` against https://api.fireflies.ai/graphql.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.fireflies.ai',
  test: {
    method: 'POST',
    path: '/graphql',
    body: { query: VIEWER_QUERY },
  },
  capabilities: [
    {
      name: 'meetings.findById',
      class: 'read',
      description:
        'Fetch a single Fireflies transcript by id. Pass `{ variables: { transcriptId } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              transcriptId: {
                type: 'string',
                description: 'The Fireflies transcript / meeting id.',
              },
            },
            required: ['transcriptId'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: FIND_MEETING_BY_ID_QUERY,
          variables: '{variables}',
        },
      },
    },
    {
      name: 'meetings.findRecent',
      class: 'read',
      description:
        'List the most recent Fireflies transcripts. Pass `{ variables: { limit } }` where `limit` is the page size.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              limit: {
                type: 'integer',
                minimum: 1,
                maximum: 50,
                description: 'Number of recent transcripts to return.',
              },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: FIND_RECENT_MEETING_QUERY,
          variables: '{variables}',
        },
      },
    },
    {
      name: 'meetings.findByQuery',
      class: 'read',
      description:
        'Search Fireflies transcripts by title, host email, participant email, or date range. Pass `{ variables: { title?, hostEmail?, participantEmail?, fromDate?, toDate?, limit? } }`.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Substring match against the meeting title.' },
              hostEmail: { type: 'string', description: 'Filter meetings by host email.' },
              participantEmail: {
                type: 'string',
                description: 'Filter meetings by participant email.',
              },
              fromDate: {
                type: 'string',
                description: 'Inclusive lower bound of the meeting date (ISO 8601).',
              },
              toDate: {
                type: 'string',
                description: 'Inclusive upper bound of the meeting date (ISO 8601).',
              },
              limit: { type: 'integer', minimum: 1, maximum: 50 },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: FIND_MEETING_BY_QUERY_QUERY,
          variables: '{variables}',
        },
      },
    },
    {
      name: 'audio.upload',
      class: 'mutation',
      description:
        'Upload an audio file by URL for Fireflies to transcribe. Pass `{ variables: { input: { url, title?, attendees? } } }`. Fireflies only accepts publicly fetchable URLs (mp3, mp4, wav, m4a, ogg).',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              input: {
                type: 'object',
                properties: {
                  url: {
                    type: 'string',
                    description: 'Publicly accessible audio URL Fireflies will fetch.',
                  },
                  title: { type: 'string', description: 'Optional title for the transcription.' },
                  attendees: {
                    type: 'array',
                    description: 'Optional attendees to associate with the meeting.',
                    items: {
                      type: 'object',
                      properties: {
                        displayName: { type: 'string' },
                        email: { type: 'string' },
                        phoneNumber: { type: 'string' },
                      },
                    },
                  },
                  webhook: {
                    type: 'string',
                    description: 'Optional webhook URL Fireflies will call when transcription completes.',
                  },
                  saveVideo: { type: 'boolean' },
                },
                required: ['url'],
              },
            },
            required: ['input'],
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: UPLOAD_AUDIO_MUTATION,
          variables: '{variables}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'user.getDetails',
      class: 'read',
      description:
        'Return Fireflies user details. Pass `{ variables: { userId } }` to fetch a specific user, or `{ variables: {} }` for the authenticated viewer.',
      parameters: {
        type: 'object',
        properties: {
          variables: {
            type: 'object',
            properties: {
              userId: {
                type: 'string',
                description: 'The Fireflies user id; omit to return the authenticated viewer.',
              },
            },
          },
        },
        required: ['variables'],
      },
      request: {
        method: 'POST',
        path: '/graphql',
        body: {
          query: GET_USER_DETAILS_QUERY,
          variables: '{variables}',
        },
      },
    },
  ],
})
