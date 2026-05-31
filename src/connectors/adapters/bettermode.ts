import { declarativeRestConnector } from './declarative-rest.js'

// Bettermode exposes a single GraphQL endpoint at https://api.bettermode.com.
// The activepieces piece uses an api-key style token (member auth token) sent
// as a Bearer header; mutations (badge assign/revoke, discussion/question
// creation) all POST a GraphQL document + variables to /.
export const bettermodeConnector = declarativeRestConnector({
  kind: 'bettermode',
  displayName: 'Bettermode',
  description:
    'Assign or revoke member badges and create discussions or questions in a Bettermode community.',
  auth: { kind: 'api-key', hint: 'Bettermode member access token (Bearer).' },
  category: 'crm',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.bettermode.com',
  test: {
    method: 'POST',
    path: '/',
    body: { query: '{ __typename }' },
  },
  capabilities: [
    {
      name: 'badge.assign',
      class: 'mutation',
      description: 'Assign a badge to a member identified by email.',
      parameters: {
        type: 'object',
        properties: {
          badgeId: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['badgeId', 'email'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation AssignBadge($badgeId: ID!, $email: String!) { assignBadge(badgeId: $badgeId, input: { email: $email }) { id } }',
          variables: { badgeId: '{badgeId}', email: '{email}' },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'badge.revoke',
      class: 'mutation',
      description: 'Revoke a previously assigned badge from a member.',
      parameters: {
        type: 'object',
        properties: {
          badgeId: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['badgeId', 'email'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation RevokeBadge($badgeId: ID!, $email: String!) { revokeBadge(badgeId: $badgeId, input: { email: $email }) { status } }',
          variables: { badgeId: '{badgeId}', email: '{email}' },
        },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'discussion.create',
      class: 'mutation',
      description: 'Create a discussion post in a Bettermode space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          tagNames: { type: 'array', items: { type: 'string' } },
          locked: { type: 'boolean' },
        },
        required: ['spaceId', 'title', 'content'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation CreateDiscussion($spaceId: ID!, $title: String!, $content: String!, $tagNames: [String!], $locked: Boolean) { createPost(spaceId: $spaceId, input: { postTypeId: "discussion", title: $title, content: $content, tagNames: $tagNames, locked: $locked }) { id slug } }',
          variables: {
            spaceId: '{spaceId}',
            title: '{title}',
            content: '{content}',
            tagNames: '{tagNames}',
            locked: '{locked}',
          },
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'question.create',
      class: 'mutation',
      description: 'Create a question post in a Bettermode space.',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          tagNames: { type: 'array', items: { type: 'string' } },
          locked: { type: 'boolean' },
        },
        required: ['spaceId', 'title', 'content'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation CreateQuestion($spaceId: ID!, $title: String!, $content: String!, $tagNames: [String!], $locked: Boolean) { createPost(spaceId: $spaceId, input: { postTypeId: "question", title: $title, content: $content, tagNames: $tagNames, locked: $locked }) { id slug } }',
          variables: {
            spaceId: '{spaceId}',
            title: '{title}',
            content: '{content}',
            tagNames: '{tagNames}',
            locked: '{locked}',
          },
        },
      },
      cas: 'native-idempotency',
    },
  ],
})
