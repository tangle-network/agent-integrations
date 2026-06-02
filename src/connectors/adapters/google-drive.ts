/**
 * @stable Google Drive connector — doc-flow-in for legal/tax/creative agents.
 *
 * Three capabilities, picked to cover "agent pulls a document the user
 * dropped in a folder" without trying to expose all of Drive's surface:
 *
 *   list_files(folderId?, query?, pageSize?)
 *     → {files: [{id, name, mimeType, modifiedTime, size?, md5Checksum?}], nextPageToken?}
 *     Read. files.list with a `'<folder>' in parents` clause when folderId
 *     is provided, otherwise the user's whole Drive scoped by Drive query.
 *
 *   read_file(fileId, format?)
 *     → {name, mimeType, content: string | base64, encoding: 'utf-8' | 'base64'}
 *     Read. For Google-native types (Docs/Sheets/Slides) we use
 *     `files.export` with the requested export mime; for binary types
 *     (PDF, images, .docx) we use `files.get?alt=media` and base64 the
 *     bytes. Caller decides what to do with each.
 *
 *   watch_folder(folderId, channelId, address, ttlMs?)
 *     → {channelId, resourceId, expiration}
 *     Mutation (creates a push notification channel). CAS: native-idempotency
 *     by way of the caller-supplied `channelId` — re-issuing the same
 *     channelId returns 409, which we surface as `idempotentReplay: true`
 *     after pulling the existing channel's `resourceId` from
 *     `DataSource.metadata.watchedChannels[channelId]`.
 *
 * Auth: OAuth2 with `drive.readonly` (list/read) + `drive` (watch). We
 * scope to readonly by default and require the operator to opt into the
 * full-write scope only if they intend to use watch_folder. The
 * `requiredScopes` field on each capability gates this in the agent's
 * tool registry — the agent never sees `watch_folder` unless the grant
 * carries `drive`.
 *
 * Why no upload capability in v1: upload is a multi-part / resumable
 * dance that's properly its own connector pack (write-doc workflows
 * need an authoritative consistency model, a separate review path,
 * etc.). Doc-flow-in is the load-bearing case for the five product
 * agents — doc-flow-out lives in the appropriate kind-specific pack
 * (e.g., docuseal-out, gmail send_reply, sheets update_row).
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '../oauth.js'

const SCOPES_READONLY = ['https://www.googleapis.com/auth/drive.readonly']
const SCOPE_WATCH = 'https://www.googleapis.com/auth/drive'
// Per-file write scope: lets the connector create/modify/delete only files it
// created or that were explicitly shared with the app — strictly narrower
// than SCOPE_WATCH, which is full-Drive read+write.
const SCOPE_WRITE = 'https://www.googleapis.com/auth/drive.file'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

/** OAuth client config the factory closes over. */
export interface GoogleDriveOptions {
  clientId: string
  clientSecret: string
  /** When true, request the broader `drive` scope at connect-time so
   *  the operator can use watch_folder. Default false — request only
   *  `drive.readonly` and gate watch_folder via `requiredScopes`. */
  includeWatchScope?: boolean
  /** Default request timeout in ms. Applied per-fetch via AbortSignal. */
  timeoutMs?: number
}

export function googleDrive(opts: GoogleDriveOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const timeoutMs = opts.timeoutMs ?? 30_000
  // Default scopes now include drive.file so fresh OAuth grants pick up the
  // narrow per-file write permission required by upload/create/delete/move.
  // Read paths still work under drive.readonly; watch_folder still needs the
  // broader `drive` scope and is gated per-capability via requiredScopes.
  const base = [...SCOPES_READONLY, SCOPE_WRITE]
  const scopes = opts.includeWatchScope ? [...base, SCOPE_WATCH] : base
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'google-drive',
      displayName: 'Google Drive',
      description:
        "Read and watch files in the user's Google Drive. List a folder, fetch a document's contents (Docs/Sheets/PDFs/.docx), and subscribe to folder changes via push notifications.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes,
        clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
        clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
        extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      },
      category: 'storage',
      defaultConsistencyModel: 'authoritative',
      rateLimit: { requests: 1000, windowMs: 60_000, scope: 'oauth-client' },
      capabilities: [
        {
          name: 'list_files',
          class: 'read',
          description:
            "List files visible to the connected Drive account. Optionally scope to a folder by id and/or pass a Drive query string (e.g., \"mimeType='application/pdf' and modifiedTime > '2025-01-01T00:00:00Z'\").",
          parameters: {
            type: 'object',
            properties: {
              folderId: { type: 'string', description: 'Drive folder id; when present, restricts to direct children.' },
              query: { type: 'string', description: "Optional Drive query expression; appended with AND if folderId is set." },
              pageSize: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
              pageToken: { type: 'string', description: 'Continuation token returned by a previous call.' },
            },
          },
        },
        {
          name: 'read_file',
          class: 'read',
          description:
            "Read a file's contents. Google-native types are exported (Docs → text/plain by default, Sheets → text/csv, Slides → application/pdf); binary types are returned as base64.",
          parameters: {
            type: 'object',
            properties: {
              fileId: { type: 'string' },
              exportMime: {
                type: 'string',
                description:
                  "Export mime override for Google-native types. Defaults: Docs=text/plain, Sheets=text/csv, Slides=application/pdf.",
              },
            },
            required: ['fileId'],
          },
        },
        {
          name: 'watch_folder',
          class: 'mutation',
          description:
            "Create a push-notification channel for a folder. Drive POSTs change notifications to `address`; the channel expires at `expiration` (max 7 days). Pass the same channelId on retry to replay the existing channel.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WATCH],
          parameters: {
            type: 'object',
            properties: {
              folderId: { type: 'string' },
              channelId: { type: 'string', description: 'Caller-controlled UUID; also used as idempotency key.' },
              address: { type: 'string', description: 'HTTPS URL Drive will POST change notifications to.' },
              ttlMs: { type: 'integer', minimum: 60_000, description: 'Channel lifetime in ms. Drive caps at 7 days.' },
            },
            required: ['folderId', 'channelId', 'address'],
          },
        },
        {
          name: 'upload_file',
          class: 'mutation',
          description:
            "Upload a file to Drive via multipart upload. `content` is the file body; set `encoding='base64'` for binary payloads. Optional `parents` places the file in a specific folder.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'File name including extension.' },
              mimeType: { type: 'string', description: "MIME type. Defaults to 'application/octet-stream'." },
              parents: { type: 'array', items: { type: 'string' }, description: 'Parent folder ids.' },
              content: { type: 'string', description: 'File contents. Decoded per `encoding`.' },
              encoding: { type: 'string', enum: ['utf-8', 'base64'], default: 'utf-8' },
            },
            required: ['name', 'content'],
          },
        },
        {
          name: 'create_folder',
          class: 'mutation',
          description:
            "Create a folder in Drive. Optionally nest under `parents`. Returns the new folder's id.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              parents: { type: 'array', items: { type: 'string' }, description: 'Parent folder ids.' },
            },
            required: ['name'],
          },
        },
        {
          name: 'delete_file',
          class: 'mutation',
          description:
            "Permanently delete a file or folder by id. Bypasses trash — the operation is irreversible.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              fileId: { type: 'string' },
            },
            required: ['fileId'],
          },
        },
        {
          name: 'move_file',
          class: 'mutation',
          description:
            "Move a file/folder by changing its parents. Removes `removeParents` and adds `addParents` in a single PATCH. At least one of removeParents/addParents is required.",
          cas: 'native-idempotency',
          externalEffect: true,
          requiredScopes: [SCOPE_WRITE],
          parameters: {
            type: 'object',
            properties: {
              fileId: { type: 'string' },
              addParents: { type: 'array', items: { type: 'string' } },
              removeParents: { type: 'array', items: { type: 'string' } },
            },
            required: ['fileId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'list_files') return listFiles(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'read_file') return readFile(inv, accessToken, timeoutMs)
      throw new Error(`google-drive: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'watch_folder') return watchFolder(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'upload_file') return uploadFile(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'create_folder') return createFolder(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'delete_file') return deleteFile(inv, accessToken, timeoutMs)
      if (inv.capabilityName === 'move_file') return moveFile(inv, accessToken, timeoutMs)
      throw new Error(`google-drive: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
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
        throw new Error('google-drive.refreshToken: missing refresh token')
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
        const res = await fetch(`${API}/about?fields=user`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return { ok: false, reason: `Google rejected Drive token (${res.status}) — reconnect required` }
        }
        if (!res.ok) return { ok: false, reason: `Google Drive returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

async function listFiles(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const args = (inv.args ?? {}) as {
    folderId?: string
    query?: string
    pageSize?: number
    pageToken?: string
  }
  const q: string[] = []
  if (args.folderId) q.push(`'${args.folderId.replace(/'/g, "\\'")}' in parents`)
  if (args.query) q.push(`(${args.query})`)
  q.push('trashed = false')
  const params = new URLSearchParams({
    q: q.join(' and '),
    pageSize: String(args.pageSize ?? 100),
    fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,size,md5Checksum,parents)',
  })
  if (args.pageToken) params.set('pageToken', args.pageToken)
  const res = await fetch(`${API}/files?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive list_files ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    nextPageToken?: string
    files?: Array<Record<string, unknown>>
  }
  return {
    data: { files: json.files ?? [], nextPageToken: json.nextPageToken },
    fetchedAt: Date.now(),
  }
}

const GOOGLE_NATIVE_DEFAULTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
}

async function readFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityReadResult> {
  const { fileId, exportMime } = (inv.args ?? {}) as { fileId: string; exportMime?: string }
  const metaRes = await fetch(`${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (metaRes.status === 401 || metaRes.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${metaRes.status})`, inv.source.id)
  }
  if (metaRes.status === 404) {
    throw new Error(`google-drive read_file: file ${fileId} not found`)
  }
  if (!metaRes.ok) {
    const text = await metaRes.text().catch(() => '')
    throw new Error(`google-drive read_file meta ${metaRes.status}: ${text.slice(0, 200)}`)
  }
  const meta = (await metaRes.json()) as { id: string; name: string; mimeType: string; modifiedTime?: string }

  const isNative = meta.mimeType.startsWith('application/vnd.google-apps.')
  const fetchedAt = Date.now()
  if (isNative) {
    const targetMime = exportMime ?? GOOGLE_NATIVE_DEFAULTS[meta.mimeType] ?? 'text/plain'
    const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(targetMime)}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`google-drive read_file export ${res.status}: ${text.slice(0, 200)}`)
    }
    const isTextLike = /^text\/|application\/(json|xml|csv|javascript)/.test(targetMime)
    if (isTextLike) {
      const content = await res.text()
      return {
        data: { name: meta.name, mimeType: targetMime, content, encoding: 'utf-8', modifiedTime: meta.modifiedTime },
        fetchedAt,
      }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      data: { name: meta.name, mimeType: targetMime, content: buf.toString('base64'), encoding: 'base64', modifiedTime: meta.modifiedTime },
      fetchedAt,
    }
  }

  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive read_file media ${res.status}: ${text.slice(0, 200)}`)
  }
  const isTextLike = /^text\/|application\/(json|xml|csv|javascript)/.test(meta.mimeType)
  if (isTextLike) {
    const content = await res.text()
    return {
      data: { name: meta.name, mimeType: meta.mimeType, content, encoding: 'utf-8', modifiedTime: meta.modifiedTime },
      fetchedAt,
    }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    data: { name: meta.name, mimeType: meta.mimeType, content: buf.toString('base64'), encoding: 'base64', modifiedTime: meta.modifiedTime },
    fetchedAt,
  }
}

async function watchFolder(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { folderId, channelId, address, ttlMs } = inv.args as {
    folderId: string
    channelId: string
    address: string
    ttlMs?: number
  }
  const body: Record<string, unknown> = {
    id: channelId,
    type: 'web_hook',
    address,
  }
  if (ttlMs && ttlMs > 0) body.expiration = String(Date.now() + ttlMs)
  const res = await fetch(`${API}/files/${encodeURIComponent(folderId)}/watch`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 409) {
    // Channel id collision — Drive returns the existing record info via
    // the metadata bag on our side. We surface it as an idempotent replay
    // so callers can keep using the same channelId across retries.
    const cached = (inv.source.metadata.watchedChannels as Record<string, { resourceId: string; expiration?: string }> | undefined)?.[channelId]
    return {
      status: 'committed',
      data: { channelId, resourceId: cached?.resourceId, expiration: cached?.expiration },
      committedAt: Date.now(),
      idempotentReplay: true,
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive watch_folder ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { id: string; resourceId: string; expiration?: string }
  return {
    status: 'committed',
    data: { channelId: json.id, resourceId: json.resourceId, expiration: json.expiration },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function uploadFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    name?: string
    mimeType?: string
    parents?: string[]
    content?: string
    encoding?: 'utf-8' | 'base64'
  }
  if (!args.name) throw new Error('google-drive upload_file: `name` is required')
  if (args.content === undefined || args.content === null) {
    throw new Error('google-drive upload_file: `content` is required')
  }
  const mimeType = args.mimeType ?? 'application/octet-stream'
  const metadata: Record<string, unknown> = { name: args.name, mimeType }
  if (args.parents?.length) metadata.parents = args.parents

  const boundary = `tangle-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const encoding = args.encoding ?? 'utf-8'
  const bodyBytes = encoding === 'base64'
    ? Buffer.from(args.content, 'base64')
    : Buffer.from(args.content, 'utf-8')

  // multipart/related: JSON metadata part + raw bytes part. We use a binary
  // body so the bytes survive untransformed; Buffer.concat handles both UTF-8
  // and binary uniformly.
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    'utf-8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf-8')
  const body = Buffer.concat([head, bodyBytes, tail])

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,parents,modifiedTime,size,md5Checksum`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive upload_file ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    name: string
    mimeType: string
    parents?: string[]
    modifiedTime?: string
    size?: string
    md5Checksum?: string
  }
  return {
    status: 'committed',
    data: {
      id: json.id,
      name: json.name,
      mimeType: json.mimeType,
      parents: json.parents ?? [],
      modifiedTime: json.modifiedTime,
      size: json.size,
      md5Checksum: json.md5Checksum,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createFolder(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as { name?: string; parents?: string[] }
  if (!args.name) throw new Error('google-drive create_folder: `name` is required')
  const body: Record<string, unknown> = {
    name: args.name,
    mimeType: 'application/vnd.google-apps.folder',
  }
  if (args.parents?.length) body.parents = args.parents
  const res = await fetch(`${API}/files?fields=id,name,mimeType,parents,modifiedTime`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive create_folder ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    name: string
    mimeType: string
    parents?: string[]
    modifiedTime?: string
  }
  return {
    status: 'committed',
    data: {
      id: json.id,
      name: json.name,
      mimeType: json.mimeType,
      parents: json.parents ?? [],
      modifiedTime: json.modifiedTime,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function deleteFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as { fileId?: string }
  if (!args.fileId) throw new Error('google-drive delete_file: `fileId` is required')
  const res = await fetch(`${API}/files/${encodeURIComponent(args.fileId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  // Drive returns 204 No Content on success.
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive delete_file ${res.status}: ${text.slice(0, 200)}`)
  }
  return {
    status: 'committed',
    data: { fileId: args.fileId, deleted: true },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function moveFile(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    fileId?: string
    addParents?: string[]
    removeParents?: string[]
  }
  if (!args.fileId) throw new Error('google-drive move_file: `fileId` is required')
  if (!args.addParents?.length && !args.removeParents?.length) {
    throw new Error('google-drive move_file: at least one of `addParents` or `removeParents` is required')
  }
  const params = new URLSearchParams({ fields: 'id,name,parents,modifiedTime' })
  if (args.addParents?.length) params.set('addParents', args.addParents.join(','))
  if (args.removeParents?.length) params.set('removeParents', args.removeParents.join(','))
  const res = await fetch(`${API}/files/${encodeURIComponent(args.fileId)}?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    // Empty body — the parent changes ride on the query string per the
    // files.update contract; we still send {} so the server gets a valid
    // JSON document.
    body: '{}',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Drive rejected token (${res.status})`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-drive move_file ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    name: string
    parents?: string[]
    modifiedTime?: string
  }
  return {
    status: 'committed',
    data: {
      id: json.id,
      name: json.name,
      parents: json.parents ?? [],
      modifiedTime: json.modifiedTime,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('google-drive: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Google Drive access token expired and no refresh token', '')
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
  return creds.accessToken
}
