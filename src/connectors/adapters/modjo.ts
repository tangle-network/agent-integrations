import { declarativeRestConnector } from './declarative-rest.js'

// Modjo — Conversation intelligence platform. Export call records with transcripts and AI summaries, and list users and teams.
// Auth: api-key. Base: https://api.modjo.ai. Docs: https://help.modjo.ai/en/articles/9310645-modjo-api
export const modjoConnector = declarativeRestConnector({
  kind: 'modjo',
  displayName: 'Modjo',
  description: 'Conversation intelligence platform. Export call records with transcripts and AI summaries, and list users and teams.',
  auth: {
    kind: 'api-key',
    hint: 'Create an API key in Modjo (Administrator or Manager role required); copy it immediately as it is shown only once. Sent as the X-API-KEY header.',
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.modjo.ai',
  credentialPlacement: { kind: 'header', header: 'X-API-KEY' },
  defaultHeaders: { 'content-type': 'application/json', accept: 'application/json' },
  test: { method: 'GET', path: '/v1/users', query: { page: '1', perPage: '1' } },
  capabilities: [
    {
      name: 'calls.export',
      class: 'read',
      description: 'Retrieve a paginated list of calls with optional relations such as transcripts, AI summaries, and contacts.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          transcript: { type: 'boolean' },
          aiSummary: { type: 'boolean' },
          contacts: { type: 'boolean' },
        },
        required: ['page', 'perPage'],
      },
      request: {
        method: 'POST',
        path: '/v1/calls/exports',
        body: {
          pagination: { page: '{page}', perPage: '{perPage}' },
          relations: {
            transcript: '{transcript}',
            aiSummary: '{aiSummary}',
            contacts: '{contacts}',
          },
        },
      },
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'Retrieve a paginated list of users in the Modjo workspace.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'integer' }, perPage: { type: 'integer' } },
        required: ['page', 'perPage'],
      },
      request: {
        method: 'GET',
        path: '/v1/users',
        query: { page: '{page}', perPage: '{perPage}' },
      },
    },
    {
      name: 'teams.list',
      class: 'read',
      description: 'Retrieve a paginated list of teams in the Modjo workspace.',
      parameters: {
        type: 'object',
        properties: { page: { type: 'integer' }, perPage: { type: 'integer' } },
        required: ['page', 'perPage'],
      },
      request: {
        method: 'GET',
        path: '/v1/teams',
        query: { page: '{page}', perPage: '{perPage}' },
      },
    },
  ],
})
