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
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'like.write', 'offline.access']

const TWITTER_SPEC: RestConnectorSpec = {
  kind: 'twitter',
  displayName: 'Twitter',
  description: 'Post tweets and reply to tweets on Twitter.',
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
  test: { method: 'GET', path: '/tweets/search/recent' },
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
