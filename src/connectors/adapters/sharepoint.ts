/**
 * Microsoft Graph SharePoint connector — file/site surface for the agent.
 *
 *   search_sites(query)                                   → read
 *     `GET /sites?search=<query>` — find SharePoint sites the connected
 *     user can see. Returns the minimum fields the agent needs to chain a
 *     drive/file call: id (composite "host,site-id,web-id"), name, webUrl.
 *
 *   list_drive_items(siteId[, folderId])                  → read
 *     `GET /sites/{siteId}/drive/root/children` (or `/items/{folderId}/children`).
 *     Returns the children of a site's default document library, or a
 *     subfolder if `folderId` is supplied. The agent uses this to walk
 *     the tree before downloading or uploading.
 *
 *   search_drive(siteId, query)                           → read
 *     `GET /sites/{siteId}/drive/root/search(q='<query>')` — server-side
 *     content + filename search across a site's default drive.
 *
 *   get_item_content(siteId, itemId)                      → read
 *     `GET /sites/{siteId}/drive/items/{itemId}/content` — pull the bytes
 *     of a small text/json/csv file. We cap at 4 MiB and return decoded
 *     UTF-8; binary or oversize → `{ binary: true, downloadUrl }` so the
 *     caller can stream out-of-band.
 *
 *   upload_file(siteId, parentFolderId, filename, content[, contentType])
 *                                                         → mutation; cas: 'native-idempotency'
 *     `PUT /sites/{siteId}/drive/items/{parentFolderId}:/{filename}:/content`
 *     — small-file upload (<= 4 MiB). Graph exposes `@odata.etag` on the
 *     returned `DriveItem`, so we emit `etagAfter` for downstream CAS. No
 *     `Idempotency-Key` header at the Graph layer — `MutationGuard` above
 *     the connector handles dedup-on-retry by key.
 *
 *   create_folder(siteId, parentFolderId, name)           → mutation; cas: 'native-idempotency'
 *     `POST /sites/{siteId}/drive/items/{parentFolderId}/children` with a
 *     `folder` facet and `@microsoft.graph.conflictBehavior: 'fail'`. Graph
 *     enforces sibling-name uniqueness within a parent, so (parentFolderId,
 *     name) is the natural idempotency tuple — `MutationGuard` short-circuits
 *     duplicate posts by key, and a true cross-tenant conflict surfaces as
 *     `ResourceContention`.
 *
 * Auth: standard OAuth2 against the v2.0 endpoint, same client/secret as
 * microsoft-calendar / microsoft-teams / outlook-mail (one M365 app). The
 * `Sites.Read.All` scope is required for the read surface; `Files.ReadWrite.All`
 * is required for upload + create-folder. `offline_access` is required to
 * receive a `refresh_token` from v2.0 — without it the connection silently
 * dies after the access token's first hour.
 *
 * Consistency model: 'authoritative'. SharePoint exposes etags on every
 * DriveItem, so callers can chain a list/get → mutation under real CAS for
 * follow-up patch/delete flows (those land in a follow-up — this adapter
 * stays scoped to the create/upload/discovery surface that satisfies the
 * Tier-1 storage pack on the catalog).
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type ConnectorCredentials,
  CredentialsExpired,
  ResourceContention,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPES = [
  'https://graph.microsoft.com/Sites.Read.All',
  'https://graph.microsoft.com/Files.ReadWrite.All',
  // offline_access is required on v2.0 to receive a refresh_token.
  'offline_access',
]
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH = 'https://graph.microsoft.com/v1.0'

// In-line download size cap for `get_item_content`. Larger files are
// surfaced as `{ binary: true, downloadUrl }` so the caller streams them
// out-of-band rather than blowing the agent's tool-result envelope.
const MAX_INLINE_BYTES = 4 * 1024 * 1024

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface SharePointOptions {
  clientId: string
  clientSecret: string
}

export function sharepoint(opts: SharePointOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'sharepoint',
      displayName: 'SharePoint',
      description:
        "Let your agent discover SharePoint sites, list/search their document libraries, read small file contents, upload files, and create folders. Etag-CAS available on every DriveItem for follow-up patch/delete flows.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'MS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      },
      category: 'storage',
      defaultConsistencyModel: 'authoritative',
      capabilities: [
        {
          name: 'search_sites',
          class: 'read',
          description:
            'Search SharePoint sites visible to the connected user. Returns id, name, and webUrl per match.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Free-text query (site title / description).' },
              top: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_drive_items',
          class: 'read',
          description:
            "List children of a SharePoint site's default document library, optionally scoped to a subfolder by itemId.",
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id (composite "host,site-id,web-id").' },
              folderId: {
                type: 'string',
                description: 'Optional DriveItem id of a folder; omit to list the root.',
              },
              top: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            },
            required: ['siteId'],
          },
        },
        {
          name: 'search_drive',
          class: 'read',
          description:
            "Server-side content + filename search across a site's default document library.",
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              query: { type: 'string', description: 'Search string passed to Graph search(q).' },
              top: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['siteId', 'query'],
          },
        },
        {
          name: 'get_item_content',
          class: 'read',
          description:
            'Download a small text file from a SharePoint drive (cap 4 MiB). Returns decoded UTF-8 content, or { binary: true, downloadUrl } for binary / oversize files.',
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              itemId: { type: 'string', description: 'DriveItem id of the file.' },
            },
            required: ['siteId', 'itemId'],
          },
        },
        {
          name: 'upload_file',
          class: 'mutation',
          description:
            "Upload a small file (<= 4 MiB) into a SharePoint document library. Returns the new DriveItem id + etag for downstream CAS.",
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              parentFolderId: {
                type: 'string',
                description: "Parent folder DriveItem id (use 'root' for the drive root).",
              },
              filename: { type: 'string', description: 'Target filename, e.g. report.csv.' },
              content: { type: 'string', description: 'UTF-8 file body.' },
              contentType: {
                type: 'string',
                description: "MIME type, defaults to 'text/plain'.",
              },
            },
            required: ['siteId', 'parentFolderId', 'filename', 'content'],
          },
        },
        {
          name: 'create_folder',
          class: 'mutation',
          description:
            'Create a folder under a parent DriveItem. Fails (conflict) if a folder of the same name already exists — Graph enforces sibling-name uniqueness server-side, which gives us idempotent retries by (parentFolderId, name).',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              parentFolderId: {
                type: 'string',
                description: "Parent folder DriveItem id (use 'root' for the drive root).",
              },
              name: { type: 'string', description: 'New folder name.' },
            },
            required: ['siteId', 'parentFolderId', 'name'],
          },
        },
        {
          name: 'files.delete',
          class: 'mutation',
          description:
            'Delete a file or folder DriveItem. Graph returns 204 on success. (siteId, itemId) is the natural idempotency tuple — a re-delete of a missing item surfaces as 404 mapped to a tombstone result.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              itemId: { type: 'string', description: 'DriveItem id of the file or folder to delete.' },
            },
            required: ['siteId', 'itemId'],
          },
        },
        {
          name: 'files.move',
          class: 'mutation',
          description:
            "Move a file or folder DriveItem to a new parent (and optionally rename it). PATCH on the DriveItem with parentReference + optional name.",
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              itemId: { type: 'string', description: 'DriveItem id of the file or folder to move.' },
              newParentFolderId: {
                type: 'string',
                description: "Destination parent folder DriveItem id (use 'root' for the drive root).",
              },
              newName: { type: 'string', description: 'Optional new filename for the moved item.' },
            },
            required: ['siteId', 'itemId', 'newParentFolderId'],
          },
        },
        {
          name: 'permissions.grant',
          class: 'mutation',
          description:
            "Grant a user (by email) access to a DriveItem at the requested role ('read' or 'write'). Uses the Graph invite action so the grant is created or upserted by recipient.",
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              itemId: { type: 'string', description: 'DriveItem id being shared.' },
              email: { type: 'string', description: 'Recipient email address.' },
              role: {
                type: 'string',
                description: "Permission role ('read' or 'write'). Defaults to 'read'.",
              },
              sendInvitation: {
                type: 'boolean',
                description: "Whether Graph should email the invite. Defaults to false.",
              },
              message: { type: 'string', description: 'Optional invitation message body.' },
            },
            required: ['siteId', 'itemId', 'email'],
          },
        },
        {
          name: 'permissions.revoke',
          class: 'mutation',
          description:
            "Revoke a specific permission on a DriveItem. Graph returns 204 on success. (siteId, itemId, permissionId) is the natural idempotency tuple.",
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              itemId: { type: 'string', description: 'DriveItem id whose permission is being revoked.' },
              permissionId: { type: 'string', description: 'Permission id from list_permissions / grant response.' },
            },
            required: ['siteId', 'itemId', 'permissionId'],
          },
        },
        {
          name: 'lists.items.create',
          class: 'mutation',
          description:
            "Create a list item in a SharePoint list. Caller provides the field bag (column key → value). Graph rejects duplicates by list-defined unique columns server-side; MutationGuard handles dedup-on-retry by key.",
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              siteId: { type: 'string', description: 'Graph site id.' },
              listId: { type: 'string', description: 'SharePoint list id (or list display name resolved by the caller).' },
              fields: {
                type: 'object',
                description: 'Map of column internal-name → value. Must include all required columns the list defines.',
                additionalProperties: true,
              },
            },
            required: ['siteId', 'listId', 'fields'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(
        inv.source.credentials,
        clientId,
        clientSecret,
      )
      if (inv.capabilityName === 'search_sites') {
        const { query, top } = inv.args as { query: string; top?: number }
        const t = clamp(top ?? 20, 1, 50)
        const url = `${GRAPH}/sites?search=${encodeURIComponent(query)}&$top=${t}&$select=id,name,displayName,webUrl,description`
        const json = await graphGet<{
          value?: Array<{
            id: string
            name?: string
            displayName?: string
            webUrl?: string
            description?: string
          }>
        }>(url, accessToken, inv.source.id)
        const sites = (json.value ?? []).map((s) => ({
          id: s.id,
          name: s.displayName ?? s.name,
          webUrl: s.webUrl,
          description: s.description,
        }))
        return { data: { sites }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_drive_items') {
        const { siteId, folderId, top } = inv.args as {
          siteId: string
          folderId?: string
          top?: number
        }
        const t = clamp(top ?? 50, 1, 200)
        const path = folderId
          ? `/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(folderId)}/children`
          : `/sites/${encodeURIComponent(siteId)}/drive/root/children`
        const url = `${GRAPH}${path}?$top=${t}&$select=id,name,size,webUrl,file,folder,lastModifiedDateTime,eTag`
        const json = await graphGet<{
          value?: Array<{
            id: string
            name?: string
            size?: number
            webUrl?: string
            eTag?: string
            lastModifiedDateTime?: string
            file?: { mimeType?: string }
            folder?: { childCount?: number }
          }>
          '@odata.nextLink'?: string
        }>(url, accessToken, inv.source.id)
        const items = (json.value ?? []).map((it) => ({
          id: it.id,
          name: it.name,
          size: it.size,
          webUrl: it.webUrl,
          etag: it.eTag,
          lastModifiedAt: it.lastModifiedDateTime,
          kind: it.folder ? 'folder' : 'file',
          mimeType: it.file?.mimeType,
          childCount: it.folder?.childCount,
        }))
        return {
          data: { items, nextLink: json['@odata.nextLink'] },
          fetchedAt: Date.now(),
        }
      }
      if (inv.capabilityName === 'search_drive') {
        const { siteId, query, top } = inv.args as {
          siteId: string
          query: string
          top?: number
        }
        const t = clamp(top ?? 20, 1, 50)
        // Graph search(q='…') — single quotes are escaped by doubling.
        const q = query.replace(/'/g, "''")
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/root/search(q='${encodeURIComponent(q)}')?$top=${t}&$select=id,name,size,webUrl,file,folder,lastModifiedDateTime,eTag`
        const json = await graphGet<{
          value?: Array<{
            id: string
            name?: string
            size?: number
            webUrl?: string
            eTag?: string
            lastModifiedDateTime?: string
            file?: { mimeType?: string }
            folder?: { childCount?: number }
          }>
        }>(url, accessToken, inv.source.id)
        const items = (json.value ?? []).map((it) => ({
          id: it.id,
          name: it.name,
          size: it.size,
          webUrl: it.webUrl,
          etag: it.eTag,
          lastModifiedAt: it.lastModifiedDateTime,
          kind: it.folder ? 'folder' : 'file',
          mimeType: it.file?.mimeType,
        }))
        return { data: { items }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'get_item_content') {
        const { siteId, itemId } = inv.args as { siteId: string; itemId: string }
        // Resolve metadata first so we know the size + mimeType before
        // blindly pulling bytes. Cheap call — single HEAD-equivalent.
        const metaUrl = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}?$select=id,name,size,file,webUrl,@microsoft.graph.downloadUrl,eTag`
        const meta = await graphGet<{
          id: string
          name?: string
          size?: number
          webUrl?: string
          eTag?: string
          file?: { mimeType?: string }
          '@microsoft.graph.downloadUrl'?: string
        }>(metaUrl, accessToken, inv.source.id)
        const downloadUrl = meta['@microsoft.graph.downloadUrl']
        if (typeof meta.size === 'number' && meta.size > MAX_INLINE_BYTES) {
          return {
            data: {
              binary: true,
              id: meta.id,
              name: meta.name,
              size: meta.size,
              mimeType: meta.file?.mimeType,
              downloadUrl,
              reason: `file size ${meta.size}B exceeds ${MAX_INLINE_BYTES}B inline cap`,
            },
            etag: meta.eTag,
            fetchedAt: Date.now(),
          }
        }
        const contentUrl = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}/content`
        const res = await fetch(contentUrl, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 404) {
          return {
            data: { found: false, id: itemId },
            fetchedAt: Date.now(),
          }
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint get_item_content ${res.status}: ${text.slice(0, 200)}`)
        }
        const mimeType = meta.file?.mimeType ?? res.headers.get('content-type') ?? ''
        if (!isTextLikeMime(mimeType)) {
          return {
            data: {
              binary: true,
              id: meta.id,
              name: meta.name,
              size: meta.size,
              mimeType,
              downloadUrl,
              reason: `mimeType ${mimeType || 'unknown'} is not text-like`,
            },
            etag: meta.eTag,
            fetchedAt: Date.now(),
          }
        }
        const buf = await res.arrayBuffer()
        if (buf.byteLength > MAX_INLINE_BYTES) {
          return {
            data: {
              binary: true,
              id: meta.id,
              name: meta.name,
              size: buf.byteLength,
              mimeType,
              downloadUrl,
              reason: `downloaded ${buf.byteLength}B exceeds ${MAX_INLINE_BYTES}B inline cap`,
            },
            etag: meta.eTag,
            fetchedAt: Date.now(),
          }
        }
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
        return {
          data: {
            binary: false,
            id: meta.id,
            name: meta.name,
            size: buf.byteLength,
            mimeType,
            content: text,
          },
          etag: meta.eTag,
          fetchedAt: Date.now(),
        }
      }
      throw new Error(`sharepoint: unknown read capability ${inv.capabilityName}`)
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const accessToken = await ensureFreshAccessToken(
        inv.source.credentials,
        clientId,
        clientSecret,
      )
      if (inv.capabilityName === 'upload_file') {
        const { siteId, parentFolderId, filename, content, contentType } = inv.args as {
          siteId: string
          parentFolderId: string
          filename: string
          content: string
          contentType?: 'string' | string
        }
        const bytes = new TextEncoder().encode(content)
        if (bytes.byteLength > MAX_INLINE_BYTES) {
          throw new Error(
            `sharepoint upload_file: content size ${bytes.byteLength}B exceeds simple-upload cap ${MAX_INLINE_BYTES}B (use createUploadSession for larger files)`,
          )
        }
        // Graph small-file upload: PUT .../items/{parent}:/{filename}:/content
        // 'root' is accepted as the literal parent id for the drive root.
        const parentSegment =
          parentFolderId === 'root' ? 'root' : `items/${encodeURIComponent(parentFolderId)}`
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/${parentSegment}:/${encodeURIComponent(filename)}:/content`
        const res = await fetch(url, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': contentType || 'text/plain',
          },
          body: bytes,
          signal: AbortSignal.timeout(30_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 412 || res.status === 409) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on upload_file (${res.status})`,
            [],
          )
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint upload_file ${res.status}: ${text.slice(0, 200)}`)
        }
        const created = (await res.json()) as {
          id: string
          name?: string
          webUrl?: string
          size?: number
          eTag?: string
          '@odata.etag'?: string
        }
        return {
          status: 'committed',
          data: {
            id: created.id,
            name: created.name,
            webUrl: created.webUrl,
            size: created.size,
          },
          etagAfter: created['@odata.etag'] ?? created.eTag,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'create_folder') {
        const { siteId, parentFolderId, name } = inv.args as {
          siteId: string
          parentFolderId: string
          name: string
        }
        const parentSegment =
          parentFolderId === 'root' ? 'root' : `items/${encodeURIComponent(parentFolderId)}`
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/${parentSegment}/children`
        const body = {
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 409 || res.status === 412) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on create_folder (${res.status}) — folder may already exist`,
            [],
          )
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint create_folder ${res.status}: ${text.slice(0, 200)}`)
        }
        const created = (await res.json()) as {
          id: string
          name?: string
          webUrl?: string
          eTag?: string
          '@odata.etag'?: string
        }
        return {
          status: 'committed',
          data: { id: created.id, name: created.name, webUrl: created.webUrl },
          etagAfter: created['@odata.etag'] ?? created.eTag,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'files.delete') {
        const { siteId, itemId } = inv.args as { siteId: string; itemId: string }
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}`
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 412 || res.status === 409) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on files.delete (${res.status})`,
            [],
          )
        }
        if (res.status === 404) {
          // Tombstone: subsequent retries should land here; report idempotent
          // success so MutationGuard's replay path stays honest.
          return {
            status: 'committed',
            data: { id: itemId, deleted: true, alreadyMissing: true },
            committedAt: Date.now(),
            idempotentReplay: true,
          }
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint files.delete ${res.status}: ${text.slice(0, 200)}`)
        }
        return {
          status: 'committed',
          data: { id: itemId, deleted: true },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'files.move') {
        const { siteId, itemId, newParentFolderId, newName } = inv.args as {
          siteId: string
          itemId: string
          newParentFolderId: string
          newName?: string
        }
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}`
        const body: Record<string, unknown> = {
          parentReference: { id: newParentFolderId },
        }
        if (typeof newName === 'string' && newName.length > 0) body.name = newName
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 409 || res.status === 412) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on files.move (${res.status})`,
            [],
          )
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint files.move ${res.status}: ${text.slice(0, 200)}`)
        }
        const moved = (await res.json()) as {
          id: string
          name?: string
          webUrl?: string
          eTag?: string
          '@odata.etag'?: string
          parentReference?: { id?: string; path?: string }
        }
        return {
          status: 'committed',
          data: {
            id: moved.id,
            name: moved.name,
            webUrl: moved.webUrl,
            parentReference: moved.parentReference,
          },
          etagAfter: moved['@odata.etag'] ?? moved.eTag,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'permissions.grant') {
        const { siteId, itemId, email, role, sendInvitation, message } = inv.args as {
          siteId: string
          itemId: string
          email: string
          role?: string
          sendInvitation?: boolean
          message?: string
        }
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}/invite`
        const body: Record<string, unknown> = {
          recipients: [{ email }],
          roles: [role === 'write' ? 'write' : 'read'],
          requireSignIn: true,
          sendInvitation: Boolean(sendInvitation),
        }
        if (typeof message === 'string' && message.length > 0) body.message = message
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 409 || res.status === 412) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on permissions.grant (${res.status})`,
            [],
          )
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint permissions.grant ${res.status}: ${text.slice(0, 200)}`)
        }
        const json = (await res.json()) as {
          value?: Array<{ id?: string; roles?: string[]; grantedToV2?: unknown }>
        }
        const granted = json.value ?? []
        return {
          status: 'committed',
          data: { permissions: granted },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'permissions.revoke') {
        const { siteId, itemId, permissionId } = inv.args as {
          siteId: string
          itemId: string
          permissionId: string
        }
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/items/${encodeURIComponent(itemId)}/permissions/${encodeURIComponent(permissionId)}`
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 412 || res.status === 409) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on permissions.revoke (${res.status})`,
            [],
          )
        }
        if (res.status === 404) {
          return {
            status: 'committed',
            data: { permissionId, revoked: true, alreadyMissing: true },
            committedAt: Date.now(),
            idempotentReplay: true,
          }
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint permissions.revoke ${res.status}: ${text.slice(0, 200)}`)
        }
        return {
          status: 'committed',
          data: { permissionId, revoked: true },
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      if (inv.capabilityName === 'lists.items.create') {
        const { siteId, listId, fields } = inv.args as {
          siteId: string
          listId: string
          fields: Record<string, unknown>
        }
        const url = `${GRAPH}/sites/${encodeURIComponent(siteId)}/lists/${encodeURIComponent(listId)}/items`
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ fields }),
          signal: AbortSignal.timeout(15_000),
        })
        if (res.status === 401 || res.status === 403) {
          throw new CredentialsExpired(
            `Microsoft Graph rejected token (${res.status})`,
            inv.source.id,
          )
        }
        if (res.status === 409 || res.status === 412) {
          throw new ResourceContention(
            `Microsoft Graph reported conflict on lists.items.create (${res.status})`,
            [],
          )
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(`sharepoint lists.items.create ${res.status}: ${text.slice(0, 200)}`)
        }
        const created = (await res.json()) as {
          id: string
          webUrl?: string
          eTag?: string
          '@odata.etag'?: string
          fields?: Record<string, unknown>
        }
        return {
          status: 'committed',
          data: { id: created.id, webUrl: created.webUrl, fields: created.fields },
          etagAfter: created['@odata.etag'] ?? created.eTag,
          committedAt: Date.now(),
          idempotentReplay: false,
        }
      }
      throw new Error(`sharepoint: unknown mutation capability ${inv.capabilityName}`)
    },

    async exchangeOAuth(input) {
      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth client not configured (MS_OAUTH_CLIENT_ID / _SECRET)')
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
        scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
        metadata: {},
      }
    },

    async refreshToken(creds) {
      if (creds.kind !== 'oauth2' || !creds.refreshToken) {
        throw new Error('sharepoint.refreshToken: missing refresh token')
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
        const accessToken = await ensureFreshAccessToken(
          source.credentials,
          clientId,
          clientSecret,
        )
        // Cheapest probe that proves Sites.Read.All — `/sites/root` is
        // the tenant's default root site. Doesn't require a known siteId.
        const res = await fetch(`${GRAPH}/sites/root?$select=id`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            reason: `Microsoft rejected token (${res.status}) — reconnect required`,
          }
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

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('sharepoint: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('SharePoint access token expired and no refresh token', '')
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

async function graphGet<T>(url: string, accessToken: string, dataSourceId: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, dataSourceId)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`sharepoint GET ${url} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(Math.max(lo, Math.floor(n)), hi)
}

// Text-like mime detection — covers the realistic agent surface (csv,
// json, markdown, xml, source code). Anything else is surfaced as binary
// with a downloadUrl so the caller streams it out-of-band.
function isTextLikeMime(mime: string): boolean {
  if (!mime) return false
  const m = mime.toLowerCase()
  if (m.startsWith('text/')) return true
  if (m === 'application/json' || m.endsWith('+json')) return true
  if (m === 'application/xml' || m.endsWith('+xml')) return true
  if (m === 'application/javascript' || m === 'application/typescript') return true
  if (m === 'application/csv') return true
  return false
}
