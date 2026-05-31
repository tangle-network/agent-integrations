import { declarativeRestConnector } from './declarative-rest.js'

export const socialkitConnector = declarativeRestConnector({
  kind: 'socialkit',
  displayName: 'Socialkit',
  description: 'Fetch YouTube video details, transcripts, summaries, and comments.',
  auth: { kind: 'api-key', hint: 'Socialkit API key.' },
  category: 'storage',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.socialkit.io/api',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'youtube.details',
      class: 'read',
      description: 'Get YouTube video details including title, description, duration, and metadata.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'YouTube video URL' } },
        required: ['url'],
      },
      request: { method: 'GET', path: '/youtube/details', query: { url: '{url}' } },
    },
    {
      name: 'youtube.transcript',
      class: 'read',
      description: 'Get the transcript of a YouTube video.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'YouTube video URL' } },
        required: ['url'],
      },
      request: { method: 'GET', path: '/youtube/transcript', query: { url: '{url}' } },
    },
    {
      name: 'youtube.summary',
      class: 'read',
      description: 'Get an AI-generated summary of a YouTube video.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'YouTube video URL' } },
        required: ['url'],
      },
      request: { method: 'GET', path: '/youtube/summary', query: { url: '{url}' } },
    },
    {
      name: 'youtube.comments',
      class: 'read',
      description: 'Fetch comments from a YouTube video with optional filtering and sorting.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'YouTube video URL' },
          limit: { type: 'integer', description: 'Number of comments to retrieve (max 100, default 10)' },
          sortBy: { type: 'string', description: 'Sort order: relevance or time' },
        },
        required: ['url'],
      },
      request: {
        method: 'GET',
        path: '/youtube/comments',
        query: { url: '{url}', limit: '{limit}', sortBy: '{sortBy}' },
      },
    },
  ],
})
