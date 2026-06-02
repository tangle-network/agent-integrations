import { declarativeRestConnector } from './declarative-rest.js'

export const avomaConnector = declarativeRestConnector({
  kind: 'avoma',
  displayName: 'Avoma',
  description:
    'Push dialer call records into Avoma and pull meeting transcripts/recordings from the AI Meeting Assistant.',
  auth: { kind: 'api-key', hint: 'Avoma API key sent as the Authorization header.' },
  category: 'calendar',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.avoma.com/v1',
  test: { method: 'GET', path: '/meetings', query: { page_size: '1' } },
  capabilities: [
    {
      name: 'calls.create',
      class: 'mutation',
      description:
        'Register a completed call from an external dialer (HubSpot, Twilio, Zoom, etc.) so Avoma can ingest the recording and transcribe it.',
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
          participants: { type: 'array' },
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
        path: '/calls',
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
    },
    {
      name: 'meetings.transcription.get',
      class: 'read',
      description: 'Fetch the transcript for a recorded Avoma meeting by its UUID.',
      parameters: {
        type: 'object',
        properties: { meeting_uuid: { type: 'string' } },
        required: ['meeting_uuid'],
      },
      request: {
        method: 'GET',
        path: '/meetings/{meeting_uuid}/transcriptions',
      },
    },
    {
      name: 'meetings.recording.get',
      class: 'read',
      description: 'Fetch the recording metadata and download URL for an Avoma meeting.',
      parameters: {
        type: 'object',
        properties: { meeting_uuid: { type: 'string' } },
        required: ['meeting_uuid'],
      },
      request: {
        method: 'GET',
        path: '/meetings/{meeting_uuid}/recordings',
      },
    },
    {
      name: 'calls.update',
      class: 'mutation',
      description:
        'Update fields on a previously-registered call (e.g. correct start/end timestamps, attach a recording_url that was not ready at create time, change participants). Pass only the fields you want to change in `patch`.',
      parameters: {
        type: 'object',
        properties: {
          external_id: {
            type: 'string',
            description: 'External call id used at create time; identifies the call to update.',
          },
          patch: {
            type: 'object',
            description:
              'Partial call object; only the fields supplied are forwarded to Avoma. Supports start_at, end_at, frm, to, frm_name, to_name, recording_url, participants, answered, is_voicemail, additional_details.',
            properties: {
              start_at: { type: 'string' },
              end_at: { type: 'string' },
              frm: { type: 'string' },
              to: { type: 'string' },
              frm_name: { type: 'string' },
              to_name: { type: 'string' },
              recording_url: { type: 'string' },
              participants: { type: 'array' },
              answered: { type: 'boolean' },
              is_voicemail: { type: 'boolean' },
              additional_details: { type: 'string' },
            },
          },
        },
        required: ['external_id', 'patch'],
      },
      request: {
        method: 'PATCH',
        path: '/calls/{external_id}',
        body: '{patch}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'calls.cancel',
      class: 'mutation',
      description:
        'Cancel/remove a previously-registered call by its external id. Used when an external dialer logs a call that was later voided.',
      parameters: {
        type: 'object',
        properties: {
          external_id: {
            type: 'string',
            description: 'External call id used at create time; identifies the call to cancel.',
          },
        },
        required: ['external_id'],
      },
      request: {
        method: 'DELETE',
        path: '/calls/{external_id}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'notes.create',
      class: 'mutation',
      description:
        'Attach a note (free-form text) to a recorded Avoma meeting. Useful for adding human or agent-generated annotations after the meeting is processed.',
      parameters: {
        type: 'object',
        properties: {
          meeting_uuid: {
            type: 'string',
            description: 'UUID of the meeting the note is attached to.',
          },
          note: {
            type: 'string',
            description: 'Note body text.',
          },
        },
        required: ['meeting_uuid', 'note'],
      },
      request: {
        method: 'POST',
        path: '/meetings/{meeting_uuid}/notes',
        body: {
          note: '{note}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
