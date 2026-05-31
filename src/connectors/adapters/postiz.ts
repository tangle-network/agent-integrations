import { declarativeRestConnector } from './declarative-rest.js'

export const postizConnector = declarativeRestConnector({
  kind: 'postiz',
  displayName: 'Postiz',
  description: 'Manage social media posts and scheduling across 30+ platforms.',
  auth: { kind: 'api-key', hint: 'Postiz API key from Settings > Developers > Public API' },
  category: 'other',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.postiz.com/api/v1',
  test: { method: 'GET', path: '/integrations' },
  capabilities: [
    {
      name: 'posts.create',
      class: 'mutation',
      description: 'Create a new social media post.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Text content of the post' },
          type: { type: 'string', enum: ['now', 'draft', 'schedule'], description: 'Post type: immediate, draft, or scheduled' },
          date: { type: 'string', description: 'ISO 8601 publish date for scheduled posts' },
          media: { type: 'object', description: 'Media file paths to attach' },
          shortLink: { type: 'boolean', description: 'Automatically shorten URLs' },
          settings: { type: 'object', description: 'Platform-specific settings' },
        },
        required: ['content', 'type'],
      },
      request: { method: 'POST', path: '/posts', body: { content: '{content}', type: '{type}', date: '{date}', media: '{media}', shortLink: '{shortLink}', settings: '{settings}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'posts.list',
      class: 'read',
      description: 'List all social media posts.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/posts' },
    },
    {
      name: 'posts.delete',
      class: 'mutation',
      description: 'Delete a social media post.',
      parameters: {
        type: 'object',
        properties: { postId: { type: 'string', description: 'The ID of the post to delete' } },
        required: ['postId'],
      },
      request: { method: 'DELETE', path: '/posts/{postId}' },
      cas: 'native-idempotency',
    },
    {
      name: 'integrations.list',
      class: 'read',
      description: 'List connected social media platform integrations.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/integrations' },
    },
    {
      name: 'analytics.platform',
      class: 'read',
      description: 'Get analytics for a specific platform.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: 'Number of days to look back (e.g. 7, 30, 90)' },
        },
        required: ['days'],
      },
      request: { method: 'GET', path: '/analytics/platform', query: { days: '{days}' } },
    },
    {
      name: 'analytics.post',
      class: 'read',
      description: 'Get analytics for a specific post.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'The ID of the post' },
        },
        required: ['postId'],
      },
      request: { method: 'GET', path: '/analytics/posts/{postId}' },
    },
    {
      name: 'media.upload',
      class: 'mutation',
      description: 'Upload media from a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Public URL of the image or video to upload' },
        },
        required: ['url'],
      },
      request: { method: 'POST', path: '/media/upload', body: { url: '{url}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'slots.find',
      class: 'read',
      description: 'Find available posting slots.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      request: { method: 'GET', path: '/slots/available' },
    },
  ],
})
