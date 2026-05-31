/**
 * Microsoft OneDrive connector — the Graph half of the doc-flow-in pattern
 * (mirror of `google-drive.ts`, swapping the upstream for `/me/drive/...`).
 *
 * Three capabilities, picked to cover "agent pulls a document the user
 * dropped in a folder" without trying to expose all of OneDrive's surface:
 *
 *   list_files(folderId?, query?, top?, skipToken?)
 *     → {files: [{id, name, eTag, lastModifiedDateTime, size, file?, folder?, parentReference}], nextLink?}
 *     Read. `GET /me/drive/items/{folderId}/children` when folderId is
 *     supplied, otherwise `GET /me/drive/root/children`. `query` is sent
 *     through Graph `$search="…"` (KQL) with the required
 *     `ConsistencyLevel: eventual` header — Graph 400s if you mix
 *     `$search` with `$orderby`, so we suppress the order clause whenever
 *     a search is active. Same shape Outlook Mail uses.
 *
 *   read_file(fileId)
 *     → {name, mimeType, content: string | base64, encoding: 'utf-8' | 'base64', eTag?, lastModifiedDateTime?}
 *     Read. Graph's content endpoint is `GET /me/drive/items/{id}/content`
 *     which 302-redirects to a short-lived pre-signed download URL. fetch
 *     follows the redirect transparently. Text-like mime types are
 *     returned utf-8; everything else is base64.
 *
 *   watch_folder(folderId, notificationUrl, ttlMinutes?, clientState?)
 *     → {subscriptionId, expirationDateTime, resource}
 *     Mutation. `POST /subscriptions` with
 *     `resource = "/me/drive/items/{folderId}"`. Graph caps OneDrive
 *     subscription lifetime at ~30 days (we default to 4230 minutes ≈ 70
 *     hours to match the Outlook Mail default, since callers usually
 *     renew on the same cadence regardless of upstream). CAS:
 *     `native-idempotency` via the SDK's idempotency-key short-circuit
 *     above the connector — Graph does not have a request-id analogue on
 *     `/subscriptions`, so re-issuing the call without dedup would
 *     create a fresh subscription each time. We do not call `getSchedule`
 *     here because subscriptions are not slot-allocated like calendar
 *     events; there is no "two callers grabbed the same channel" race.
 *
 * Auth: OAuth2 v2.0 endpoint with `Files.Read` (list/read) and
 * `Files.ReadWrite` (watch). `offline_access` is required to receive a
 * refresh token; without it Graph hands back access tokens only and the
 * connection silently dies after ~1 hour. We scope to readonly by
 * default and require the operator to opt into the write scope only if
 * they intend to use `watch_folder` — gated via `requiredScopes` on the
 * capability so the agent's tool registry never surfaces it without the
 * grant.
 *
 * Why no upload capability in v1: same reasoning as google-drive —
 * resumable uploads are properly their own connector pack (write-doc
 * workflows need an authoritative consistency model, a separate review
 * path). Doc-flow-in is the load-bearing case.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPE_READ = 'https://graph.microsoft.com/Files.Read'
const SCOPE_WRITE = 'https://graph.microsoft.com/Files.ReadWrite'
// offline_access is required to receive a refresh_token from the v2.0
// endpoint; without it Graph hands back access tokens only and the
// connection silently dies after ~1 hour.
const SCOPE_OFFLINE = 'offline_access'
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const API = 'https://graph.microsoft.com/v1.0'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface OneDriveOptions {
  clientId: string
  clientSecret: string
  /** When true, request the broader `Files.ReadWrite` scope at
   *  connect-time so the operator can use `watch_folder`. Default false —
   *  request only `Files.Read` and gate `watch_folder` via
   *  `requiredScopes`. */
  includeWriteScope?: boolean
  /** Default request timeout in ms. Applied per-fetch via AbortSignal. */
  timeoutMs?: number
}

export function oneDrive(opts: OneDriveOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  const scopes = opts.includeWriteScope
    ? [SCOPE_READ, SCOPE_WRITE, SCOPE_OFFLINE]
    : [SCOPE_READ, SCOPE_OFFLINE]
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'onedrive',
      displayName: 'OneDrive',
      description:
        "Read and watch files in the user's OneDrive. List a folder, fetch a document's contents (Word/Excel/PowerPoint/PDF/images), and subscribe to folder change notifications via Graph subscriptions.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes,
        clientIdEnv: 'MS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      },
      category: 'storage',
      defaultConsistencyModel: 'authoritative',
      // Graph throttles per-app per-mailbox at roughly 10k requests / 10 min
      // for /me/drive. 250/s leaves plenty of headroom and matches the
      // sibling Microsoft adapters' budget so callers can reason uniformly.
      rateLimit: { requests: 250, windowMs: 1_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'list_files',
          class: 'read',
          description:
            "List driveItems visible to the connected OneDrive account. Optionally scope to a folder by id and/or pass a Graph $search (KQL), e.g. 'NDA filetype:pdf'.",
          requiredScopes: [SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              folderId: { type: 'string', description: 'driveItem id of a folder; when present, restricts to direct children. Defaults to the drive root.' },
              query: { type: 'string', description: "Graph $search KQL; mutually exclusive with $orderby (we drop orderby when search is set)." },
              top: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
              skipToken: { type: 'string', description: 'Opaque pagination cursor extracted from a previous @odata.nextLink.' },
            },
          },
        },
        {
          name: 'read_file',
          class: 'read',
          description:
            "Read a OneDrive file's contents. Text-like mime types (text/*, JSON, XML, CSV) are returned utf-8; binary types (PDF, Office docs, images) are returned base64.",
          requiredScopes: [SCOPE_READ],
          parameters: {
            type: 'object',
            properties: {
              fileId: { type: 'string', description: 'driveItem id of the file.' },
            },
            required: ['fileId'],
          },
        },
        {
          name: 'watch_folder',
          class: 'mutation',
          description:
            "Register a Graph subscription for change notifications on a folder. Graph POSTs to `notificationUrl`; the subscription expires at `expirationDateTime` (max ~30 days for OneDrive). Caller must renew before expiry.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              folderId: { type: 'string', description: 'driveItem id of the folder to watch; pass "root" to watch the drive root.' },
              notificationUrl: { type: 'string', description: 'HTTPS endpoint Graph will POST change notifications to.' },
              ttlMinutes: { type: 'integer', minimum: 1, maximum: 43200, default: 4230, description: 'Subscription lifetime in minutes. Graph caps OneDrive at ~30 days.' },
              clientState: { type: 'string', description: 'Opaque value Graph echoes back on each notification. Defaults to the idempotency key.' },
            },
            required: ['folderId', 'notificationUrl'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      if (inv.capabilityName === 'list_files') return listFiles(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'read_file') return readFile(inv, accessToken, timeoutMs)
      throw new Error(`onedrive: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      if (inv.capabilityName !== 'watch_folder') {
        throw new Error(`onedrive: unknown mutation capability ${inv.capabilityName}`)
      }
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret, inv.onCredentialsRotated)
      return watchFolder(inv, accessToken, timeoutMs)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('OneDrive OAuth client not configured (MS_OAUTH_CLIENT_ID / _SECRET)')
      }
      const tokens = await exchangeAuthorizationCode({
        tokenUrl: TOKEN_URL,
        clientId,
        clientSecret,
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
      })
      return {
        credentials: {
          kind: 'oauth2',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined,
        },
        scopes: tokens.scope?.split(/\s+/) ?? scopes,
        metadata: {},
      }
    },

    async refreshToken(creds) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        throw new Error('onedrive.refreshToken: missing refresh token')
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
        const accessToken = await ensureFreshAccessToken(source.credentials, clientId, clientSecret)
        // Cheapest Graph call that proves the OneDrive grant: GET /me/drive.
        // Hitting /me/drive (not /me) ensures the user actually has a
        // provisioned drive — corp tenants can hand out Files.Read tokens
        // to accounts that never had OneDrive enabled.
        const res = await fetch(`${API}/me/drive?$select=id`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Microsoft rejected token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `Microsoft Graph returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface DriveItem {
  id: string
  name?: string
  eTag?: string
  lastModifiedDateTime?: string
  size?: number
  webUrl?: string
  file?: { mimeType?: string; hashes?: Record<string, string> }
  folder?: { childCount?: number }
  parentReference?: { id?: string; path?: string }
}

async function listFiles(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = (inv.args ?? {}) as {
    folderId?: string
    query?: string
    top?: number
    skipToken?: string
  }
  const params = new URLSearchParams({
    $top: String(args.top ?? 100),
    $select: 'id,name,eTag,lastModifiedDateTime,size,webUrl,file,folder,parentReference',
  })
  // $search and $orderby are mutually exclusive in Graph; only emit
  // $orderby when we aren't using $search so the request doesn't 400.
  if (args.query) params.set('$search', `"${args.query}"`)
  else params.set('$orderby', 'lastModifiedDateTime desc')
  if (args.skipToken) params.set('$skiptoken', args.skipToken)

  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` }
  // ConsistencyLevel=eventual is required when $search is used.
  if (args.query) headers['ConsistencyLevel'] = 'eventual'

  const path = args.folderId
    ? `/me/drive/items/${encodeURIComponent(args.folderId)}/children`
    : '/me/drive/root/children'

  // $search at /children is only valid via the drive-wide search endpoint;
  // we switch to /me/drive/root/search(q='…') when a search query is set
  // and no folder scope is given, since that's the supported KQL surface.
  const useSearchEndpoint = !!args.query && !args.folderId
  const url = useSearchEndpoint
    ? `${API}/me/drive/root/search(q=${encodeURIComponent(`'${args.query!.replace(/'/g, "''")}'`)})?${stripSearch(params).toString()}`
    : `${API}${path}?${params.toString()}`

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`OneDrive rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 404) {
    throw new Error(`onedrive list_files: folder ${args.folderId ?? 'root'} not found`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`onedrive list_files ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    value?: DriveItem[]
    '@odata.nextLink'?: string
  }
  return {
    data: { files: json.value ?? [], nextLink: json['@odata.nextLink'] },
    fetchedAt: Date.now(),
  }
}

function stripSearch(params: URLSearchParams): URLSearchParams {
  const copy = new URLSearchParams(params)
  copy.delete('$search')
  copy.delete('$orderby')
  return copy
}

async function readFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { fileId } = (inv.args ?? {}) as { fileId: string }
  if (!fileId) throw new Error('onedrive read_file: fileId is required')

  // First fetch metadata so we know the mimeType + eTag without having to
  // sniff the redirected content-type. Graph returns `file.mimeType` for
  // any non-folder item.
  const metaUrl = `${API}/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,eTag,lastModifiedDateTime,size,file,folder`
  const metaRes = await fetch(metaUrl, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (metaRes.status === 401 || metaRes.status === 403) {
    throw new CredentialsExpired(`OneDrive rejected token (${metaRes.status})`, inv.source.id)
  }
  if (metaRes.status === 404) {
    throw new Error(`onedrive read_file: item ${fileId} not found`)
  }
  if (!metaRes.ok) {
    const text = await metaRes.text().catch(() => '')
    throw new Error(`onedrive read_file meta ${metaRes.status}: ${text.slice(0, 200)}`)
  }
  const meta = (await metaRes.json()) as DriveItem & { id: string; name?: string }
  if (meta.folder) {
    throw new Error(`onedrive read_file: item ${fileId} is a folder, not a file`)
  }
  const mimeType = meta.file?.mimeType ?? 'application/octet-stream'
  const fetchedAt = Date.now()

  // /content 302-redirects to a short-lived pre-signed download URL.
  // fetch follows redirects by default.
  const contentRes = await fetch(`${API}/me/drive/items/${encodeURIComponent(fileId)}/content`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (contentRes.status === 401 || contentRes.status === 403) {
    throw new CredentialsExpired(`OneDrive rejected token (${contentRes.status})`, inv.source.id)
  }
  if (!contentRes.ok) {
    const text = await contentRes.text().catch(() => '')
    throw new Error(`onedrive read_file content ${contentRes.status}: ${text.slice(0, 200)}`)
  }
  const isTextLike = /^text\/|application\/(json|xml|csv|javascript)/.test(mimeType)
  if (isTextLike) {
    const content = await contentRes.text()
    return {
      data: {
        name: meta.name,
        mimeType,
        content,
        encoding: 'utf-8',
        eTag: meta.eTag,
        lastModifiedDateTime: meta.lastModifiedDateTime,
      },
      etag: meta.eTag,
      fetchedAt,
    }
  }
  const buf = Buffer.from(await contentRes.arrayBuffer())
  return {
    data: {
      name: meta.name,
      mimeType,
      content: buf.toString('base64'),
      encoding: 'base64',
      eTag: meta.eTag,
      lastModifiedDateTime: meta.lastModifiedDateTime,
    },
    etag: meta.eTag,
    fetchedAt,
  }
}

async function watchFolder(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { folderId, notificationUrl, ttlMinutes, clientState } = inv.args as {
    folderId: string
    notificationUrl: string
    ttlMinutes?: number
    clientState?: string
  }
  const ttl = Math.max(1, Math.min(ttlMinutes ?? 4230, 43200))
  const expirationDateTime = new Date(Date.now() + ttl * 60_000).toISOString()
  const resource =
    folderId === 'root'
      ? '/me/drive/root'
      : `/me/drive/items/${folderId}`

  const body = {
    changeType: 'updated',
    notificationUrl,
    resource,
    expirationDateTime,
    clientState: clientState ?? inv.idempotencyKey,
  }
  const res = await fetch(`${API}/subscriptions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`OneDrive rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`onedrive watch_folder ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    expirationDateTime?: string
    resource?: string
    clientState?: string
  }
  return {
    status: 'committed',
    data: {
      subscriptionId: json.id,
      expirationDateTime: json.expirationDateTime,
      resource: json.resource,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
  onCredentialsRotated?: (credentials: ConnectorCredentials) => void,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('onedrive: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('OneDrive access token expired and no refresh token', '')
  }
  const refreshed = await refreshAccessToken({
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    refreshToken: creds.refreshToken,
  })
  creds.accessToken = refreshed.accessToken
  creds.expiresAt = refreshed.expiresIn ? Date.now() + refreshed.expiresIn * 1000 : undefined
  if (refreshed.refreshToken) creds.refreshToken = refreshed.refreshToken
  onCredentialsRotated?.({
    kind: 'oauth2',
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  })
  return creds.accessToken
}
