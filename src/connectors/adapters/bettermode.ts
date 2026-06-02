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
    {
      name: 'discussion.update',
      class: 'mutation',
      description: 'Edit an existing discussion post (title and/or content).',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'Bettermode post id to update.' },
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['postId'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation UpdateDiscussion($postId: ID!, $title: String, $content: String) { updatePost(id: $postId, input: { title: $title, content: $content }) { id slug } }',
          variables: {
            postId: '{postId}',
            title: '{title}',
            content: '{content}',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'discussion.delete',
      class: 'mutation',
      description: 'Delete a discussion post.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'Bettermode post id to delete.' },
        },
        required: ['postId'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query: 'mutation DeletePost($postId: ID!) { deletePost(id: $postId) { status } }',
          variables: { postId: '{postId}' },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'member.invite',
      class: 'mutation',
      description: 'Invite a new community member by email.',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email of the member to invite.' },
          roleId: { type: 'string', description: 'Role to assign on accept (optional).' },
          spaceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Spaces the invited member should be added to (optional).',
          },
        },
        required: ['email'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation InviteMember($email: String!, $roleId: ID, $spaceIds: [ID!]) { inviteMembers(input: { invitees: [{ email: $email }], roleId: $roleId, spaceIds: $spaceIds }) { id } }',
          variables: {
            email: '{email}',
            roleId: '{roleId}',
            spaceIds: '{spaceIds}',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'reply.create',
      class: 'mutation',
      description: 'Post a reply to a discussion or question post.',
      parameters: {
        type: 'object',
        properties: {
          postId: {
            type: 'string',
            description: 'Id of the parent discussion/question being replied to.',
          },
          content: { type: 'string', description: 'Reply body.' },
        },
        required: ['postId', 'content'],
      },
      request: {
        method: 'POST',
        path: '/',
        body: {
          query:
            'mutation CreateReply($postId: ID!, $content: String!) { createReply(postId: $postId, input: { postTypeId: "reply", content: $content }) { id } }',
          variables: {
            postId: '{postId}',
            content: '{content}',
          },
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
})
