import { declarativeRestConnector } from './declarative-rest.js'

/**
 * Reddit adapter.
 *
 * Provides access to Reddit's JSON API (api.reddit.com) for reading posts,
 * comments, and creating content across subreddits. OAuth2 flows use
 * access_token (required) and refresh_token (optional) for long-lived sessions.
 *
 * The piece surfaces the core actions from activepieces:
 * - retrieve/get post details
 * - create post/comment
 * - edit post/comment
 * - delete post/comment
 * - fetch comments on a post
 *
 * All requests must include the User-Agent header per Reddit API requirements.
 */
export const redditConnector = declarativeRestConnector({
  kind: 'reddit',
  displayName: 'Reddit',
  description:
    'Interact with Reddit — fetch and submit posts, retrieve comments, create and edit posts/comments.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    scopes: ['read', 'submit', 'edit'],
    clientIdEnv: 'REDDIT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'REDDIT_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://oauth.reddit.com',
  test: { method: 'GET', path: '/api/v1/me' },
  capabilities: [
    {
      name: 'post.retrieve',
      class: 'read',
      description: 'Retrieve a Reddit post by its ID or fullname.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string' },
        },
        required: ['postId'],
      },
      request: {
        method: 'GET',
        path: '/r/{subreddit}/comments/{postId}',
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'post.details',
      class: 'read',
      description: 'Get detailed metadata for a Reddit post including title, body, and engagement metrics.',
      parameters: {
        type: 'object',
        properties: {
          subreddit: { type: 'string' },
          postId: { type: 'string' },
        },
        required: ['subreddit', 'postId'],
      },
      request: {
        method: 'GET',
        path: '/r/{subreddit}/comments/{postId}',
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'post.create',
      class: 'mutation',
      description:
        'Create a new post in a subreddit. Supports self-posts (with title and text body) and link posts (with title and URL).',
      parameters: {
        type: 'object',
        properties: {
          subreddit: { type: 'string' },
          title: { type: 'string' },
          text: { type: 'string' },
          url: { type: 'string' },
          flair_id: { type: 'string' },
        },
        required: ['subreddit', 'title'],
      },
      request: {
        method: 'POST',
        path: '/r/{subreddit}/submit',
        body: {
          title: '{title}',
          text: '{text}',
          url: '{url}',
          flair_id: '{flair_id}',
          kind: 'self',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['submit'],
    },
    {
      name: 'comment.create',
      class: 'mutation',
      description: 'Create a comment on a Reddit post or reply to another comment.',
      parameters: {
        type: 'object',
        properties: {
          parentId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['parentId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/api/comment',
        body: {
          thing_id: '{parentId}',
          text: '{text}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
      requiredScopes: ['submit'],
    },
    {
      name: 'comments.fetch',
      class: 'read',
      description:
        'Fetch all comments on a post, optionally filtered by sort order (best, top, new, controversial, old, qa) and depth.',
      parameters: {
        type: 'object',
        properties: {
          subreddit: { type: 'string' },
          postId: { type: 'string' },
          sort: { type: 'string', enum: ['best', 'top', 'new', 'controversial', 'old', 'qa'] },
          limit: { type: 'integer' },
        },
        required: ['subreddit', 'postId'],
      },
      request: {
        method: 'GET',
        path: '/r/{subreddit}/comments/{postId}',
        query: {
          sort: '{sort}',
          limit: '{limit}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      requiredScopes: ['read'],
    },
    {
      name: 'post.edit',
      class: 'mutation',
      description: 'Edit the body text of a self-post (title is immutable post-creation).',
      parameters: {
        type: 'object',
        properties: {
          thingId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['thingId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/api/editusertext',
        body: {
          thing_id: '{thingId}',
          text: '{text}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['edit'],
    },
    {
      name: 'comment.edit',
      class: 'mutation',
      description: 'Edit the text of a comment you authored.',
      parameters: {
        type: 'object',
        properties: {
          thingId: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['thingId', 'text'],
      },
      request: {
        method: 'POST',
        path: '/api/editusertext',
        body: {
          thing_id: '{thingId}',
          text: '{text}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      cas: 'optimistic-read-verify',
      requiredScopes: ['edit'],
    },
    {
      name: 'post.delete',
      class: 'mutation',
      description: 'Delete a post you authored (permanent deletion).',
      parameters: {
        type: 'object',
        properties: {
          thingId: { type: 'string' },
        },
        required: ['thingId'],
      },
      request: {
        method: 'POST',
        path: '/api/del',
        body: {
          id: '{thingId}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      externalEffect: true,
      requiredScopes: ['edit'],
    },
    {
      name: 'comment.delete',
      class: 'mutation',
      description: 'Delete a comment you authored (permanent deletion).',
      parameters: {
        type: 'object',
        properties: {
          thingId: { type: 'string' },
        },
        required: ['thingId'],
      },
      request: {
        method: 'POST',
        path: '/api/del',
        body: {
          id: '{thingId}',
        },
        headers: {
          'User-Agent': 'AgentDev/1.0',
        },
      },
      externalEffect: true,
      requiredScopes: ['edit'],
    },
  ],
})
