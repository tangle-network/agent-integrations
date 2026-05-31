import { declarativeRestConnector } from './declarative-rest.js'

export const granolaConnector = declarativeRestConnector({
  kind: 'granola',
  displayName: 'Granola',
  description: 'Retrieve meeting notes, search for notes, and access note transcripts.',
  auth: { kind: 'api-key', hint: 'Granola API key from Settings > API.' },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.granola.ai/v1',
  test: { method: 'GET', path: '/notes' },
  capabilities: [
    {
      name: 'notes.list',
      class: 'read',
      description: 'List all notes with optional filtering by creation/update date and pagination.',
      parameters: {
        type: 'object',
        properties: {
          created_after: { type: 'string', description: 'ISO 8601 date to filter notes created after this date.' },
          created_before: { type: 'string', description: 'ISO 8601 date to filter notes created before this date.' },
          updated_after: { type: 'string', description: 'ISO 8601 date to filter notes updated after this date.' },
          page_size: { type: 'integer', description: 'Number of notes per page (1–30), default 10.' },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/notes',
        query: {
          created_after: '{created_after}',
          created_before: '{created_before}',
          updated_after: '{updated_after}',
          page_size: '{page_size}',
        },
      },
    },
    {
      name: 'notes.get',
      class: 'read',
      description: 'Retrieve a specific note by ID, with optional transcript inclusion.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string', description: 'The unique identifier of the note.' },
          include_transcript: {
            type: 'boolean',
            description: 'Include the full meeting transcript showing who said what and when.',
          },
        },
        required: ['note_id'],
      },
      request: {
        method: 'GET',
        path: '/notes/{note_id}',
        query: { include_transcript: '{include_transcript}' },
      },
    },
  ],
})
