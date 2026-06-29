/**
 * Twitter / X connector — declarative REST surface plus an OAuth-client
 * factory.
 *
 * Two exports, same manifest:
 *   - `twitterConnector` — const instance for catalog/back-compat consumers
 *     that resolve OAuth client config out-of-band.
 *   - `twitter(opts)` — factory for hub substrate registration
 *     (`HUB_FACTORY_ADAPTERS` accepts `(opts: {clientId, clientSecret}) =>
 *     ConnectorAdapter`). Closes over the OAuth client pair and adds
 *     `exchangeOAuth` / `refreshToken` on top of the declarative base.
 *
 * `kind: 'twitter'` is the hub providerId — it must match the platform
 * callback `?provider=twitter` exactly.
 *
 * PKCE is deliberately NOT implemented here: the platform broker generates
 * the S256 challenge pair generically and hands the verifier into
 * `exchangeOAuth(input.codeVerifier)` — the adapter only relays it to the
 * token endpoint.
 */

import { type ConnectorAdapter, type ConnectorCredentials } from '../types.js'
import { declarativeRestConnector, type RestConnectorSpec } from './declarative-rest.js'

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize'
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
// Read capabilities widen the grant: `follows.read` gates
// GET /users/{id}/following and `like.read` gates GET /tweets/{id}/liking_users.
// X's OAuth2 scope is the singular `like.read` (matching the existing
// `like.write`) — NOT the plural `likes.read` the issue text used.
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'follows.read', 'like.write', 'like.read', 'offline.access']

const TWITTER_SPEC: RestConnectorSpec = {
  kind: 'twitter',
  displayName: 'Twitter',
  description: 'Read and verify Twitter/X engagement (follows, tweets, likes, retweets, mentions) and post or reply to tweets.',
  auth: {
    kind: 'one_of',
    preferred: 'oauth2',
    options: [
      {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'TWITTER_OAUTH_CLIENT_ID',
        clientSecretEnv: 'TWITTER_OAUTH_CLIENT_SECRET',
      },
      {
        kind: 'api-key',
        hint: 'Twitter/X OAuth 2.0 bearer token or app/user access token.',
      },
    ],
  },
  category: 'comms',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.twitter.com/2',
  // `/users/me` is the cheapest read that proves the grant: it needs only
  // users.read, carries no required query param, and works on the free tier
  // (unlike `/tweets/search/recent`, which 400s without a `query`).
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'tweets.create',
      class: 'mutation',
      description: 'Post a new tweet.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      request: { method: 'POST', path: '/tweets', body: { text: '{text}' } },
      cas: 'native-idempotency',
    },
    {
      name: 'tweets.reply',
      class: 'mutation',
      description: 'Reply to an existing tweet.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' }, replyTo: { type: 'string' } },
        required: ['text', 'replyTo'],
      },
      request: { method: 'POST', path: '/tweets', body: { text: '{text}', reply: { in_reply_to_tweet_id: '{replyTo}' } } },
      cas: 'native-idempotency',
    },
    {
      name: 'tweets.delete',
      class: 'mutation',
      description: 'Delete a tweet authored by the authenticated user.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Tweet id to delete.' } },
        required: ['id'],
      },
      request: { method: 'DELETE', path: '/tweets/{id}' },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tweets.like',
      class: 'mutation',
      description: 'Like a tweet on behalf of the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Authenticated user id performing the like.' },
          tweet_id: { type: 'string', description: 'Tweet id to like.' },
        },
        required: ['user_id', 'tweet_id'],
      },
      request: {
        method: 'POST',
        path: '/users/{user_id}/likes',
        body: { tweet_id: '{tweet_id}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'tweets.retweet',
      class: 'mutation',
      description: 'Retweet a tweet on behalf of the authenticated user.',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'Authenticated user id performing the retweet.' },
          tweet_id: { type: 'string', description: 'Tweet id to retweet.' },
        },
        required: ['user_id', 'tweet_id'],
      },
      request: {
        method: 'POST',
        path: '/users/{user_id}/retweets',
        body: { tweet_id: '{tweet_id}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'dms.send',
      class: 'mutation',
      description: 'Send a direct message to a participant.',
      parameters: {
        type: 'object',
        properties: {
          participant_id: { type: 'string', description: 'Recipient user id.' },
          text: { type: 'string', description: 'Message text body.' },
        },
        required: ['participant_id', 'text'],
      },
      request: {
        method: 'POST',
        path: '/dm_conversations/with/{participant_id}/messages',
        body: { text: '{text}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },

    // Read capabilities (official X API v2) — power quest verification in
    // blueprint-agent. `users.me` is the anchor: it resolves the connected
    // user id every other read needs. Optional `max_results` / `pagination_token`
    // are dropped from the query when the caller omits them, so the declarative
    // engine renders the bare endpoint by default. `following`, `liking_users`,
    // and `retweeted_by` are gated behind a PAID X API tier at runtime — the
    // capability is always present; availability is the registered app's tier.
    {
      name: 'users.me',
      class: 'read',
      description:
        'Resolve the connected account (id, name, username) — anchors every other read. Pass user_fields (e.g. "public_metrics,created_at") to also fetch follower count and account age for anti-bot gating.',
      parameters: {
        type: 'object',
        properties: {
          user_fields: {
            type: 'string',
            description: 'Optional X `user.fields` selector, e.g. "public_metrics,created_at".',
          },
        },
      },
      request: { method: 'GET', path: '/users/me', query: { 'user.fields': '{user_fields}' } },
    },
    {
      name: 'users.following',
      class: 'read',
      description:
        'List the accounts a user follows, for verifying follows and followed_by. Cursor with pagination_token. Gated behind a paid X API tier.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User id whose following list to read (from users.me).' },
          max_results: { type: 'integer', description: 'Page size (1–1000).' },
          pagination_token: { type: 'string', description: 'Cursor from a prior page (meta.next_token).' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/users/{id}/following',
        query: { max_results: '{max_results}', pagination_token: '{pagination_token}' },
      },
    },
    {
      name: 'users.tweets',
      class: 'read',
      description:
        'List recent tweets authored by a user, for verifying tweeted. Hashtag filtering is applied by the caller. Cursor with pagination_token.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Author user id (from users.me).' },
          max_results: { type: 'integer', description: 'Page size (5–100).' },
          pagination_token: { type: 'string', description: 'Cursor from a prior page (meta.next_token).' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/users/{id}/tweets',
        query: { max_results: '{max_results}', 'tweet.fields': 'text,created_at', pagination_token: '{pagination_token}' },
      },
    },
    {
      name: 'tweets.retweetedBy',
      class: 'read',
      description:
        'List the accounts that retweeted a tweet, for verifying retweeted. Cursor with pagination_token. Gated behind a paid X API tier.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tweet id to inspect.' },
          max_results: { type: 'integer', description: 'Page size (1–100).' },
          pagination_token: { type: 'string', description: 'Cursor from a prior page (meta.next_token).' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/tweets/{id}/retweeted_by',
        query: { max_results: '{max_results}', pagination_token: '{pagination_token}' },
      },
    },
    {
      name: 'tweets.likingUsers',
      class: 'read',
      description:
        'List the accounts that liked a tweet, for verifying liked. Requires the like.read scope and a paid X API tier.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Tweet id to inspect.' },
          max_results: { type: 'integer', description: 'Page size (1–100).' },
          pagination_token: { type: 'string', description: 'Cursor from a prior page (meta.next_token).' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/tweets/{id}/liking_users',
        query: { max_results: '{max_results}', pagination_token: '{pagination_token}' },
      },
    },
    {
      name: 'users.mentions',
      class: 'read',
      description:
        'List tweets that mention a user, for verifying mentioned. Author filtering is applied by the caller. Cursor with pagination_token.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Mentioned user id (from users.me).' },
          max_results: { type: 'integer', description: 'Page size (5–100).' },
          pagination_token: { type: 'string', description: 'Cursor from a prior page (meta.next_token).' },
        },
        required: ['id'],
      },
      request: {
        method: 'GET',
        path: '/users/{id}/mentions',
        query: { max_results: '{max_results}', 'tweet.fields': 'author_id,text', pagination_token: '{pagination_token}' },
      },
    },
  ],
}

export const twitterConnector = declarativeRestConnector(TWITTER_SPEC)

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface TwitterOptions {
  clientId: string
  clientSecret: string
}

export function twitter(opts: TwitterOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  return {
    ...declarativeRestConnector(TWITTER_SPEC),

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Twitter OAuth client not configured (TWITTER_OAUTH_CLIENT_ID / _SECRET)')
      }
      const tokens = await twitterTokenRequest(clientId, clientSecret, {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
        client_id: clientId,
      })
      return {
        credentials: {
          kind: 'oauth2',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        },
        scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
        metadata: {},
      }
    },

    async refreshToken(creds: ConnectorCredentials) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        throw new Error('twitter.refreshToken: missing refresh token (was offline.access granted?)')
      }
      const refreshed = await twitterTokenRequest(clientId, clientSecret, {
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: clientId,
      })
      return {
        kind: 'oauth2',
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? creds.refreshToken,
        expiresAt: refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined,
      }
    },
  }
}

interface TwitterTokens {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  scope?: string
}

/** X authenticates confidential clients on the token endpoint with HTTP
 *  Basic (base64 of client_id:client_secret) — body-only client credentials
 *  are rejected, so the generic `exchangeAuthorizationCode` helper (which
 *  posts them in the form body) can't be reused here. Same header on both
 *  the code exchange and the refresh grant. */
async function twitterTokenRequest(
  clientId: string,
  clientSecret: string,
  params: Record<string, string>,
): Promise<TwitterTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`twitter ${params.grant_type} token request failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
  }
}
