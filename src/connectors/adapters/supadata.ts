import { declarativeRestConnector } from './declarative-rest.js'

export const supadataConnector = declarativeRestConnector({
  kind: 'supadata',
  displayName: 'Supadata',
  description: 'Extract transcripts from YouTube videos.',
  auth: { kind: 'api-key', hint: 'Supadata API key.' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.supadata.ai',
  test: { method: 'GET', path: '/health' },
  capabilities: [
    {
      name: 'transcript.get',
      class: 'read',
      description: 'Get transcript from a YouTube video.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'YouTube video URL' },
          lang: { type: 'string', description: 'Preferred language of the transcript' },
          text: { type: 'boolean', description: 'Merge transcript into a single text instead of timestamped chunks' },
        },
        required: ['url'],
      },
      request: {
        method: 'POST',
        path: '/transcript',
        body: { url: '{url}', lang: '{lang}', text: '{text}' },
      },
    },
  ],
})
