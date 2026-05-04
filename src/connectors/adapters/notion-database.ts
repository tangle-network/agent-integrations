/**
 * Notion database connector — query + page-level CRUD against a single
 * connected database.
 *
 *   query_database(filter?, pageSize?)  → read
 *   create_page(properties)             → mutation; cas: 'native-idempotency'
 *   update_page(pageId, properties)     → mutation; cas: 'etag-if-match'
 *
 * CAS quirks worth flagging:
 *
 *   1. Notion added support for the `Idempotency-Key` HTTP header on
 *      mutating requests. We forward our SDK's idempotency key on
 *      create_page, which gives at-most-once semantics under the same
 *      key for ~24h. MutationGuard's record short-circuits above us;
 *      Notion's dedup is the second line of defense.
 *
 *   2. Notion does NOT expose a per-page etag the way Graph does. The
 *      canonical drift signal is `last_edited_time` (RFC3339). Our
 *      `update_page` capability accepts an `expectedLastEditedTime` arg;
 *      if supplied, we GET the page first and compare. Mismatch →
 *      ResourceContention with the current page state. Conflict-free
 *      callers can omit the field (last-write-wins, the Notion default).
 *
 * Auth: standard OAuth2. Notion's token endpoint follows RFC 6749 with
 * one twist — the workspace_id and bot_id come back in the response and
 * we stash them in `metadata` so the agent can address resources by
 * workspace where useful.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const AUTH_URL = 'https://api.notion.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface NotionDatabaseOptions {
  clientId: string
  clientSecret: string
}

export function notionDatabase(opts: NotionDatabaseOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    kind: 'notion-database',
    displayName: 'Notion (database)',
    description:
      "Query a Notion database, create new pages, and update existing ones with optimistic concurrency via last_edited_time.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      // Notion does not use OAuth scopes — the workspace owner picks
      // which pages/databases the integration sees during install. We
      // declare an empty scope list so the consent screen renders cleanly.
      scopes: [],
      clientIdEnv: 'NOTION_OAUTH_CLIENT_ID',
      clientSecretEnv: 'NOTION_OAUTH_CLIENT_SECRET',
      extraAuthParams: { owner: 'user' },
    },
    category: 'doc',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'query_database',
        class: 'read',
        description: 'Query the connected Notion database with an optional filter object (Notion query DSL).',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'object', description: 'Notion API filter object — passed through verbatim.' },
            pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            startCursor: { type: 'string' },
          },
        },
      },
      {
        name: 'create_page',
        class: 'mutation',
        description: 'Create a new page inside the connected database.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            properties: {
              type: 'object',
              description: 'Notion property map keyed by property name.',
            },
          },
          required: ['properties'],
        },
      },
      {
        name: 'update_page',
        class: 'mutation',
        description:
          'Update properties on an existing page. If `expectedLastEditedTime` is supplied and stale, the update is rejected with conflict.',
        cas: 'etag-if-match',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            pageId: { type: 'string' },
            properties: { type: 'object' },
            expectedLastEditedTime: {
              type: 'string',
              description: 'RFC3339 timestamp the agent observed on its last read. Drift triggers ResourceContention.',
            },
          },
          required: ['pageId', 'properties'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    if (inv.capabilityName !== 'query_database') {
      throw new Error(`notion-database: unknown read capability ${inv.capabilityName}`)
    }
    const accessToken = readToken(inv.source.credentials)
    const databaseId = readMetaString(inv.source.metadata, 'databaseId')
    const { filter, pageSize, startCursor } = inv.args as {
      filter?: unknown
      pageSize?: number
      startCursor?: string
    }
    const body: Record<string, unknown> = {
      page_size: Math.min(Math.max(1, pageSize ?? 50), 100),
    }
    if (filter) body.filter = filter
    if (startCursor) body.start_cursor = startCursor

    const res = await fetch(`${API}/databases/${encodeURIComponent(databaseId)}/query`, {
      method: 'POST',
      headers: notionHeaders(accessToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) {
      throw new CredentialsExpired('Notion rejected token (401)', inv.source.id)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`notion-database query_database ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{ id: string; last_edited_time: string; properties: unknown; url?: string }>
      has_more?: boolean
      next_cursor?: string | null
    }
    return {
      data: {
        results: json.results ?? [],
        hasMore: json.has_more ?? false,
        nextCursor: json.next_cursor ?? null,
      },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const accessToken = readToken(inv.source.credentials)
    if (inv.capabilityName === 'create_page') return createPage(inv, accessToken)
    if (inv.capabilityName === 'update_page') return updatePage(inv, accessToken)
    throw new Error(`notion-database: unknown mutation capability ${inv.capabilityName}`)
  },

  async exchangeOAuth(input) {
    if (!clientId || !clientSecret) {
      throw new Error('Notion OAuth client not configured (NOTION_OAUTH_CLIENT_ID / _SECRET)')
    }
    // Notion REQUIRES Basic auth on the token endpoint and does not
    // accept client_id/client_secret in the form body. exchangeAuthorizationCode
    // posts both in the body; Notion ignores the duplicates and accepts
    // the Basic header — but we have to add the header explicitly.
    // We do the POST inline rather than extending the helper's
    // signature, since this is the one upstream that needs Basic.
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

  async refreshToken(creds) {
    if (creds.kind !== 'oauth2' || !creds.refreshToken) {
      // Notion's standard tokens don't expire and don't ship a
      // refresh_token. If we have neither expiresAt nor refreshToken,
      // treat the existing access token as durable.
      if (creds.kind === 'oauth2' && creds.accessToken && !creds.expiresAt) {
        return creds
      }
      throw new Error('notion-database.refreshToken: missing refresh token')
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

  async test(source) {
    try {
      const accessToken = readToken(source.credentials)
      // /users/me is the cheapest grant-validity probe.
      const res = await fetch(`${API}/users/me`, {
        headers: notionHeaders(accessToken),
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) return { ok: false, reason: 'Notion rejected token (401) — reconnect required' }
      if (!res.ok) return { ok: false, reason: `Notion returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

async function createPage(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const databaseId = readMetaString(inv.source.metadata, 'databaseId')
  const { properties } = inv.args as { properties: Record<string, unknown> }
  const res = await fetch(`${API}/pages`, {
    method: 'POST',
    headers: {
      ...notionHeaders(accessToken),
      'Idempotency-Key': inv.idempotencyKey,
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Notion rejected token (401)', inv.source.id)
  }
  if (res.status === 409) {
    throw new ResourceContention('Notion idempotency-key conflict — different args under same key')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`notion-database create_page ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as { id: string; url?: string; last_edited_time?: string }
  return {
    status: 'committed',
    data: { pageId: created.id, url: created.url, lastEditedTime: created.last_edited_time },
    etagAfter: created.last_edited_time,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function updatePage(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const { pageId, properties, expectedLastEditedTime } = inv.args as {
    pageId: string
    properties: Record<string, unknown>
    expectedLastEditedTime?: string
  }
  // Optional pre-flight CAS: if the agent supplied the timestamp it
  // observed on its last read, fetch the page and compare BEFORE
  // committing. The window between this read and the patch isn't
  // closed by Notion (no If-Match), but it shrinks the race to
  // milliseconds — sufficient for typical voice-agent cadences.
  if (expectedLastEditedTime) {
    const headRes = await fetch(`${API}/pages/${encodeURIComponent(pageId)}`, {
      headers: notionHeaders(accessToken),
      signal: AbortSignal.timeout(10_000),
    })
    if (headRes.status === 401) {
      throw new CredentialsExpired('Notion rejected token (401)', inv.source.id)
    }
    if (!headRes.ok) {
      const text = await headRes.text().catch(() => '')
      throw new Error(`notion-database update_page (preflight) ${headRes.status}: ${text.slice(0, 200)}`)
    }
    const page = (await headRes.json()) as { last_edited_time?: string; properties?: unknown }
    if (page.last_edited_time && page.last_edited_time !== expectedLastEditedTime) {
      throw new ResourceContention(
        `Notion page ${pageId} was modified since the agent last read it`,
        [],
        { last_edited_time: page.last_edited_time, properties: page.properties },
      )
    }
  }

  const res = await fetch(`${API}/pages/${encodeURIComponent(pageId)}`, {
    method: 'PATCH',
    headers: notionHeaders(accessToken),
    body: JSON.stringify({ properties }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired('Notion rejected token (401)', inv.source.id)
  }
  if (res.status === 409 || res.status === 412) {
    throw new ResourceContention(`Notion update_page conflict (${res.status})`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`notion-database update_page ${res.status}: ${text.slice(0, 200)}`)
  }
  const updated = (await res.json()) as { id: string; last_edited_time?: string; url?: string }
  return {
    status: 'committed',
    data: { pageId: updated.id, url: updated.url, lastEditedTime: updated.last_edited_time },
    etagAfter: updated.last_edited_time,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

function notionHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'content-type': 'application/json',
  }
}

function readToken(creds: ConnectorCredentials): string {
  if (creds.kind !== 'oauth2' || typeof creds.accessToken !== 'string') {
    throw new Error('notion-database: expected oauth2 credentials')
  }
  return creds.accessToken
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`notion-database DataSource.metadata.${key} is missing`)
  }
  return v
}
