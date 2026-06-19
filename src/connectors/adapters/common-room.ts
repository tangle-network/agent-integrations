import { declarativeRestConnector } from './declarative-rest.js'

// Common Room — Look up community and customer contacts, their activity, segments, and tags from your Common Room workspace.
// Auth: api-key. Base: https://api.commonroom.io/community/v1. Docs: https://api.commonroom.io/docs/community.html
export const commonRoomConnector = declarativeRestConnector({
  kind: 'common-room',
  displayName: 'Common Room',
  description: 'Look up community and customer contacts, their activity, segments, and tags from your Common Room workspace.',
  auth: {
    kind: 'api-key',
    hint: 'Core API token from Common Room Settings -> API tokens (created by a workspace Admin). Sent as the Authorization: Bearer header.',
  },
  category: 'sales-intelligence',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.commonroom.io/community/v1',
  credentialPlacement: { kind: 'bearer' },
  defaultHeaders: { 'content-type': 'application/json' },
  test: { method: 'GET', path: '/api-token-status' },
  capabilities: [
    {
      name: 'contact.get_by_email',
      class: 'read',
      description: 'Return a contact\'s full Common Room profile given their email address.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address of the contact to look up.' },
        },
        required: ['email'],
      },
      request: { method: 'GET', path: '/user/{email}' },
    },
    {
      name: 'contact.search',
      class: 'read',
      description: 'Find contacts by email or linked social handles (Twitter, GitHub, LinkedIn).',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to search by.' },
          github: { type: 'string', description: 'GitHub username to search by.' },
          twitter: { type: 'string', description: 'Twitter/X handle to search by.' },
          linkedin: {
            type: 'string',
            description: 'LinkedIn profile URL or handle to search by.',
          },
        },
        required: [],
      },
      request: {
        method: 'GET',
        path: '/members',
        query: {
          email: '{email}',
          github: '{github}',
          twitter: '{twitter}',
          linkedin: '{linkedin}',
        },
      },
    },
    {
      name: 'activity_types.list',
      class: 'read',
      description: 'List the activity types available in the workspace.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/activityTypes' },
    },
    {
      name: 'segments.list',
      class: 'read',
      description: 'List the segments defined in the workspace.',
      parameters: { type: 'object', properties: {}, required: [] },
      request: { method: 'GET', path: '/segments' },
    },
    {
      name: 'contact.upsert',
      class: 'mutation',
      description: 'Create or update a contact in a destination source, optionally setting fields and custom fields.',
      parameters: {
        type: 'object',
        properties: {
          destinationSourceId: {
            type: 'string',
            description: 'ID of the destination source to write the contact into.',
          },
          fullName: { type: 'string', description: 'Full name of the contact.' },
          email: { type: 'string', description: 'Email address of the contact.' },
        },
        required: ['destinationSourceId'],
      },
      request: {
        method: 'POST',
        path: '/source/{destinationSourceId}/user',
        body: { fullName: '{fullName}', email: '{email}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
