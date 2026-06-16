/**
 * Notion connector — declarative REST surface plus an OAuth-client factory.
 *
 * Two exports, same manifest (mirrors twitter.ts):
 *   - `notionConnector` — const instance for catalog/back-compat consumers
 *     that resolve OAuth client config out-of-band.
 *   - `notion(opts)` — factory for hub substrate registration
 *     (`HUB_FACTORY_ADAPTERS` accepts `(opts: {clientId, clientSecret}) =>
 *     ConnectorAdapter`). Closes over the OAuth client pair and adds the
 *     Basic-auth `exchangeOAuth` / durable-token `refreshToken` Notion needs
 *     on top of the declarative base.
 *
 * `kind: 'notion'` is the hub providerId. This connector is the canonical
 * Notion adapter (the former `notion-database` duplicate was retired into it).
 */

import { type ConnectorAdapter, type ConnectorCredentials } from '../types.js'
import { refreshAccessToken } from '../oauth.js'
import { declarativeRestConnector, type RestConnectorSpec } from './declarative-rest.js'

const TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const NOTION_VERSION = '2022-06-28'

const NOTION_SPEC: RestConnectorSpec = {
  kind: 'notion',
  displayName: 'Notion',
  description: 'Query and manipulate Notion databases, pages, and blocks.',
  auth: {
    kind: 'oauth2',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    // Notion does not use OAuth scopes — the workspace owner picks which
    // pages/databases the integration sees during install. We declare an
    // empty scope list so the consent screen renders cleanly.
    scopes: [],
    clientIdEnv: 'NOTION_OAUTH_CLIENT_ID',
    clientSecretEnv: 'NOTION_OAUTH_CLIENT_SECRET',
    extraAuthParams: { owner: 'user' },
  },
  category: 'doc',
  defaultConsistencyModel: 'authoritative',
  baseUrl: 'https://api.notion.com/v1',
  test: { method: 'GET', path: '/users/me' },
  capabilities: [
    {
      name: 'databases.retrieve',
      class: 'read',
      description: 'Retrieve a Notion database.',
      parameters: {
        type: 'object',
        properties: { databaseId: { type: 'string' } },
        required: ['databaseId'],
      },
      request: { method: 'GET', path: '/databases/{databaseId}' },
    },
    {
      name: 'databases.query',
      class: 'read',
      description: 'Query a Notion database with filters and sorting.',
      parameters: {
        type: 'object',
        properties: {
          databaseId: { type: 'string' },
          filter: { type: 'object' },
          sorts: { type: 'array' },
          pageSize: { type: 'integer' },
        },
        required: ['databaseId'],
      },
      request: {
        method: 'POST',
        path: '/databases/{databaseId}/query',
        body: { filter: '{filter}', sorts: '{sorts}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'pages.create',
      class: 'mutation',
      description: 'Create a new Notion page.',
      parameters: {
        type: 'object',
        properties: {
          parentDatabaseId: { type: 'string' },
          title: { type: 'string' },
          properties: { type: 'object' },
        },
        required: ['parentDatabaseId', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/pages',
        body: {
          parent: { database_id: '{parentDatabaseId}' },
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
    },
    {
      name: 'pages.retrieve',
      class: 'read',
      description: 'Retrieve a Notion page.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' } },
        required: ['pageId'],
      },
      request: { method: 'GET', path: '/pages/{pageId}' },
    },
    {
      name: 'pages.update',
      class: 'mutation',
      description: 'Update a Notion page properties.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' }, properties: { type: 'object' } },
        required: ['pageId', 'properties'],
      },
      request: {
        method: 'PATCH',
        path: '/pages/{pageId}',
        body: { properties: '{properties}' },
      },
      cas: 'optimistic-read-verify',
    },
    {
      name: 'pages.archive',
      class: 'mutation',
      description: 'Archive a Notion page.',
      parameters: {
        type: 'object',
        properties: { pageId: { type: 'string' } },
        required: ['pageId'],
      },
      request: {
        method: 'PATCH',
        path: '/pages/{pageId}',
        body: { archived: true },
      },
    },
    {
      name: 'blocks.retrieve',
      class: 'read',
      description: 'Retrieve a Notion block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' } },
        required: ['blockId'],
      },
      request: { method: 'GET', path: '/blocks/{blockId}' },
    },
    {
      name: 'blocks.children',
      class: 'read',
      description: 'Retrieve all children blocks of a block or page.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, pageSize: { type: 'integer' } },
        required: ['blockId'],
      },
      request: {
        method: 'GET',
        path: '/blocks/{blockId}/children',
        query: { page_size: '{pageSize}' },
      },
    },
    {
      name: 'blocks.append',
      class: 'mutation',
      description: 'Append blocks as children of a page or block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, children: { type: 'array' } },
        required: ['blockId', 'children'],
      },
      request: {
        method: 'PATCH',
        path: '/blocks/{blockId}/children',
        body: { children: '{children}' },
      },
    },
    {
      name: 'comments.create',
      class: 'mutation',
      description: 'Add a comment to a page or block.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          richText: { type: 'array' },
        },
        required: ['blockId', 'richText'],
      },
      request: {
        method: 'POST',
        path: '/comments',
        body: {
          block_id: '{blockId}',
          rich_text: '{richText}',
        },
      },
    },
    {
      name: 'comments.retrieve',
      class: 'read',
      description: 'Retrieve comments on a block.',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' }, pageSize: { type: 'integer' } },
        required: ['blockId'],
      },
      request: {
        method: 'GET',
        path: '/comments',
        query: { block_id: '{blockId}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'users.list',
      class: 'read',
      description: 'List users in the connected Notion workspace.',
      parameters: {
        type: 'object',
        properties: {
          startCursor: { type: 'string', description: 'Pagination cursor returned by a prior call.' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      request: {
        method: 'GET',
        path: '/users',
        query: { start_cursor: '{startCursor}', page_size: '{pageSize}' },
      },
    },
    {
      name: 'blocks.update',
      class: 'mutation',
      description:
        'Update an existing Notion block. `content` carries the type-specific fields (e.g. { paragraph: { rich_text: [...] } }) Notion expects.',
      parameters: {
        type: 'object',
        properties: {
          blockId: { type: 'string' },
          content: {
            type: 'object',
            description: 'Block content patch (type-specific fields keyed by block type).',
          },
        },
        required: ['blockId', 'content'],
      },
      request: {
        method: 'PATCH',
        path: '/blocks/{blockId}',
        body: '{content}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'blocks.delete',
      class: 'mutation',
      description: 'Delete a Notion block (moves it to trash).',
      parameters: {
        type: 'object',
        properties: { blockId: { type: 'string' } },
        required: ['blockId'],
      },
      request: {
        method: 'DELETE',
        path: '/blocks/{blockId}',
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'databases.create',
      class: 'mutation',
      description: 'Create a new Notion database underneath a parent page.',
      parameters: {
        type: 'object',
        properties: {
          parentPageId: { type: 'string', description: 'Parent page id under which to create the database.' },
          title: {
            type: 'array',
            description: 'Notion rich_text array used as the database title.',
          },
          properties: {
            type: 'object',
            description: 'Schema map — property name → Notion property schema.',
          },
        },
        required: ['parentPageId', 'title', 'properties'],
      },
      request: {
        method: 'POST',
        path: '/databases',
        body: {
          parent: { type: 'page_id', page_id: '{parentPageId}' },
          title: '{title}',
          properties: '{properties}',
        },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
    {
      name: 'databases.update',
      class: 'mutation',
      description: 'Update a database title and/or schema.',
      parameters: {
        type: 'object',
        properties: {
          databaseId: { type: 'string' },
          title: { type: 'array', description: 'Optional new rich_text title.' },
          properties: { type: 'object', description: 'Optional partial schema update.' },
        },
        required: ['databaseId'],
      },
      request: {
        method: 'PATCH',
        path: '/databases/{databaseId}',
        body: { title: '{title}', properties: '{properties}' },
      },
      cas: 'native-idempotency',
      externalEffect: true,
    },
  ],
}

export const notionConnector = declarativeRestConnector(NOTION_SPEC)

/** OAuth client config the factory closes over. Caller resolves these at
 *  construction time (env, DB, secret manager — package doesn't care). */
export interface NotionOptions {
  clientId: string
  clientSecret: string
}

export function notion(opts: NotionOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  return {
    ...declarativeRestConnector(NOTION_SPEC),

    /**
     * Notion's token endpoint follows RFC 6749 with one twist — it REQUIRES
     * HTTP Basic auth (client_id:client_secret) and does NOT accept the client
     * credentials in the form body, so we POST inline rather than via the
     * generic `exchangeAuthorizationCode` helper. The workspace_id/bot_id come
     * back in the response and we stash them in `metadata` so the agent can
     * address resources by workspace where useful.
     */
    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Notion OAuth client not configured (NOTION_OAUTH_CLIENT_ID / _SECRET)')
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      })
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Notion OAuth token exchange failed: ${res.status} — ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        access_token: string
        refresh_token?: string
        bot_id?: string
        workspace_id?: string
        workspace_name?: string
        duplicated_template_id?: string
      }
      return {
        credentials: {
          kind: 'oauth2',
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
        },
        scopes: [],
        metadata: {
          botId: json.bot_id,
          workspaceId: json.workspace_id,
          workspaceName: json.workspace_name,
          // Operator picks the database in a follow-up step; default empty.
          databaseId: '',
        },
      }
    },

    /** Notion's standard tokens don't expire and don't ship a refresh_token.
     *  If we have neither expiresAt nor refreshToken, treat the existing
     *  access token as durable and return it unchanged. */
    async refreshToken(creds: ConnectorCredentials) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        if (creds.kind === 'oauth2' && creds.accessToken && !creds.expiresAt) {
          return creds
        }
        throw new Error('notion.refreshToken: missing refresh token')
      }
      const refreshed = await refreshAccessToken({
        tokenUrl: TOKEN_URL,
        clientId,
        clientSecret,
        refreshToken: creds.refreshToken,
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
