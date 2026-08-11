import {
  CredentialsExpired,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'
import {
  declarativeRestConnector,
  type RestConnectorSpec,
} from './declarative-rest.js'

const REDDIT_USER_AGENT = 'web:tools.tangle.integration-hub:v1.0 (contact: https://tangle.tools)'
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'

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
const redditSpec = {
  kind: 'reddit',
  displayName: 'Reddit',
  description:
    'Interact with Reddit — fetch and submit posts, retrieve comments, create and edit posts/comments.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: REDDIT_TOKEN_URL,
    scopes: ['identity', 'read', 'submit', 'edit'],
    pkce: 'unsupported',
    tokenClientAuthMethod: 'client_secret_basic',
    extraAuthParams: { duration: 'permanent' },
    tokenRequestHeaders: { 'User-Agent': REDDIT_USER_AGENT },
    clientIdEnv: 'REDDIT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'REDDIT_OAUTH_CLIENT_SECRET',
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://oauth.reddit.com',
  defaultHeaders: { 'User-Agent': REDDIT_USER_AGENT },
  test: { method: 'GET', path: '/api/v1/me' },
  capabilities: [
    {
      name: 'post.retrieve',
      class: 'read',
      description: 'Retrieve a Reddit post by its fullname, such as t3_abc123.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'Reddit post fullname, such as t3_abc123.' },
        },
        required: ['postId'],
      },
      request: {
        method: 'GET',
        path: '/api/info',
        query: {
          id: '{postId}',
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
          kind: { type: 'string', enum: ['self', 'link'] },
          text: { type: 'string' },
          url: { type: 'string' },
          flair_id: { type: 'string' },
        },
        required: ['subreddit', 'title', 'kind'],
      },
      request: {
        method: 'POST',
        path: '/api/submit',
        bodyEncoding: 'form',
        body: {
          api_type: 'json',
          sr: '{subreddit}',
          title: '{title}',
          kind: '{kind}',
          text: '{text}',
          url: '{url}',
          flair_id: '{flair_id}',
        },
      },
      cas: 'none',
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
        bodyEncoding: 'form',
        body: {
          api_type: 'json',
          thing_id: '{parentId}',
          text: '{text}',
        },
      },
      cas: 'none',
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
        bodyEncoding: 'form',
        body: {
          api_type: 'json',
          thing_id: '{thingId}',
          text: '{text}',
        },
      },
      cas: 'none',
      externalEffect: true,
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
        bodyEncoding: 'form',
        body: {
          api_type: 'json',
          thing_id: '{thingId}',
          text: '{text}',
        },
      },
      cas: 'none',
      externalEffect: true,
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
        bodyEncoding: 'form',
        body: {
          id: '{thingId}',
        },
      },
      cas: 'none',
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
        bodyEncoding: 'form',
        body: {
          id: '{thingId}',
        },
      },
      cas: 'none',
      externalEffect: true,
      requiredScopes: ['edit'],
    },
  ],
} satisfies RestConnectorSpec

/** Static Reddit connector used for catalog and OAuth manifest discovery. */
export const redditConnector = declarativeRestConnector(redditSpec)

/** Runtime settings for Reddit's confidential OAuth client. */
export interface RedditOptions {
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Credential-bound Reddit connector with durable access-token refresh. */
export function reddit(options: RedditOptions): ConnectorAdapter {
  const adapter = declarativeRestConnector(redditSpec)
  const now = options.now ?? Date.now
  type PendingRefresh = {
    promise: Promise<ConnectorCredentials>
    onCredentialsRotated?: ConnectorInvocation['onCredentialsRotated']
    persistence?: Promise<void>
  }
  const refreshes = new Map<string, PendingRefresh>()

  const refresh = async (credentials: ConnectorCredentials): Promise<ConnectorCredentials> => {
    if (credentials.kind !== 'oauth2' || !credentials.refreshToken) {
      throw new Error('reddit.refreshToken: missing refresh token')
    }
    const tokens = await refreshAccessToken({
      tokenUrl: REDDIT_TOKEN_URL,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      tokenClientAuthMethod: 'client_secret_basic',
      refreshToken: credentials.refreshToken,
      tokenRequestHeaders: { 'User-Agent': REDDIT_USER_AGENT },
      fetchImpl: options.fetchImpl,
    })
    if (!tokens.accessToken || !tokens.expiresIn) {
      throw new Error('Reddit token refresh returned an incomplete grant')
    }
    return {
      kind: 'oauth2',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? credentials.refreshToken,
      expiresAt: now() + tokens.expiresIn * 1000,
    }
  }
  adapter.refreshToken = refresh

  const withFreshCredentials = async (
    invocation: ConnectorInvocation,
  ): Promise<ConnectorInvocation> => {
    const credentials = invocation.source.credentials
    if (credentials.kind !== 'oauth2') {
      throw new CredentialsExpired('Reddit requires OAuth2 credentials.', invocation.source.id)
    }
    if (credentials.expiresAt !== undefined && credentials.expiresAt > now() + 60_000) {
      return invocation
    }
    if (!credentials.refreshToken) {
      throw new CredentialsExpired(
        'Reddit access token expired and no refresh token is available.',
        invocation.source.id,
      )
    }

    let pending = refreshes.get(invocation.source.id)
    if (!pending) {
      let next: PendingRefresh
      const promise = Promise.resolve().then(() => {
        if (!next.onCredentialsRotated) {
          throw new Error('reddit: credential rotation persistence callback is required before refreshing')
        }
        return refresh(credentials)
      })
      next = {
        promise,
        onCredentialsRotated: invocation.onCredentialsRotated,
      }
      pending = next
      refreshes.set(invocation.source.id, pending)
    } else if (!pending.onCredentialsRotated && invocation.onCredentialsRotated) {
      pending.onCredentialsRotated = invocation.onCredentialsRotated
    }

    const current = pending
    try {
      const refreshed = await current.promise
      current.persistence ??= Promise.resolve().then(() =>
        current.onCredentialsRotated?.(refreshed),
      )
      await current.persistence
      return {
        ...invocation,
        source: { ...invocation.source, credentials: refreshed },
      }
    } finally {
      if (refreshes.get(invocation.source.id) === current) {
        refreshes.delete(invocation.source.id)
      }
    }
  }

  return {
    ...adapter,
    async exchangeOAuth(input) {
      const tokens = await exchangeAuthorizationCode({
        tokenUrl: REDDIT_TOKEN_URL,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        tokenClientAuthMethod: 'client_secret_basic',
        code: input.code,
        codeVerifier: input.codeVerifier,
        pkce: 'unsupported',
        redirectUri: input.redirectUri,
        tokenRequestHeaders: { 'User-Agent': REDDIT_USER_AGENT },
        fetchImpl: options.fetchImpl,
      })
      if (!tokens.accessToken || !tokens.refreshToken || !tokens.expiresIn) {
        throw new Error('Reddit token exchange returned an incomplete permanent grant')
      }
      return {
        credentials: {
          kind: 'oauth2',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: now() + tokens.expiresIn * 1000,
        },
        scopes: tokens.scope?.split(/[\s,]+/).filter(Boolean) ?? [...redditSpec.auth.scopes],
        metadata: {},
      }
    },
    refreshToken: refresh,
    async executeRead(invocation) {
      return adapter.executeRead!(await withFreshCredentials(invocation))
    },
    async executeMutation(invocation) {
      return adapter.executeMutation!(await withFreshCredentials(invocation))
    },
    async test(source, onCredentialsRotated) {
      try {
        const invocation = await withFreshCredentials({
          source,
          capabilityName: '__test__',
          args: {},
          idempotencyKey: 'reddit-connection-test',
          onCredentialsRotated,
        })
        return adapter.test!(invocation.source)
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : 'unknown error',
        }
      }
    },
  }
}
