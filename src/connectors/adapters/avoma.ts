import { declarativeRestConnector } from './declarative-rest.js'

/** Avoma public API v1. The direct surface intentionally matches the three
 * actions in Avoma's published connector: call ingestion, transcription read,
 * and recording read. */
export const avomaConnector = declarativeRestConnector({
  kind: 'avoma',
  displayName: 'Avoma',
  description:
    'Push completed dialer calls into Avoma and retrieve meeting transcripts and recording URLs.',
  auth: { kind: 'api-key', hint: 'Avoma API key sent as a Bearer token.' },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.avoma.com/v1',
  test: { method: 'GET', path: '/meetings/', query: { page_size: '1' } },
  capabilities: [
    {
      name: 'calls.create',
      class: 'mutation',
      description:
        'Register a completed external-dialer call so Avoma can ingest its recording and create meeting intelligence.',
      parameters: {
        type: 'object',
        properties: {
          external_id: { type: 'string' },
          user_email: { type: 'string' },
          source: { type: 'string' },
          direction: { type: 'string' },
          start_at: { type: 'string' },
          end_at: { type: 'string' },
          frm: { type: 'string' },
          to: { type: 'string' },
          frm_name: { type: 'string' },
          to_name: { type: 'string' },
          recording_url: { type: 'string' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                email: { type: 'string' },
                crm_id: { type: 'string' },
                crm_type: { type: 'string' },
                crm_system: { type: 'string' },
              },
              required: ['name', 'email'],
            },
          },
          answered: { type: 'boolean' },
          is_voicemail: { type: 'boolean' },
          additional_details: { type: 'string' },
        },
        required: [
          'external_id',
          'user_email',
          'source',
          'direction',
          'start_at',
          'frm',
          'to',
          'recording_url',
        ],
      },
      request: {
        method: 'POST',
        path: '/calls/',
        body: {
          external_id: '{external_id}',
          user_email: '{user_email}',
          source: '{source}',
          direction: '{direction}',
          start_at: '{start_at}',
          end_at: '{end_at}',
          frm: '{frm}',
          to: '{to}',
          frm_name: '{frm_name}',
          to_name: '{to_name}',
          recording_url: '{recording_url}',
          participants: '{participants}',
          answered: '{answered}',
          is_voicemail: '{is_voicemail}',
          additional_details: '{additional_details}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'meetings.transcription.get',
      class: 'read',
      description: 'Fetch a speaker-attributed Avoma transcription by transcription UUID.',
      parameters: {
        type: 'object',
        properties: {
          transcription_uuid: { type: 'string' },
        },
        required: ['transcription_uuid'],
      },
      request: {
        method: 'GET',
        path: '/transcriptions/{transcription_uuid}',
      },
    },
    {
      name: 'meetings.recording.get',
      class: 'read',
      description: 'Fetch time-limited audio and video recording URLs for an Avoma meeting UUID.',
      parameters: {
        type: 'object',
        properties: {
          meeting_uuid: { type: 'string' },
        },
        required: ['meeting_uuid'],
      },
      request: {
        method: 'GET',
        path: '/recordings/',
        query: { meeting_uuid: '{meeting_uuid}' },
      },
    },
  ],
})
