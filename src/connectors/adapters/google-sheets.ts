/**
 * Google Sheets connector — live KB source + writable rows.
 *
 * The flagship for the "agent reads from a live spreadsheet" UX. The
 * customer points the connection at a Sheet (spreadsheetId + sheetName +
 * headerRow). We expose:
 *
 *   list_rows(filter?, limit?)
 *     → {rows: [{...header→cell}], nextCursor?}
 *     Cheap; just spreadsheets.values.get with the configured range.
 *
 *   query_rows(predicate)
 *     → same shape as list_rows but with a structured filter (k=v pairs
 *     ANDed together). Simple and explainable; no SQL.
 *
 *   update_row(rowKey, patch)
 *     → {row: {...header→cell}, updatedRange}
 *     Mutation. CAS via Sheets' spreadsheets.values.update + a
 *     pre-flight read of the row's revisionId-equivalent hash. Sheets
 *     doesn't expose a per-row etag, so we synthesize one — see
 *     `rowFingerprint`. If the fingerprint doesn't match what the agent
 *     last read, we surface ResourceContention with the current row in
 *     `currentState`.
 *
 * KB binding: when a Sheet is `consistencyModel: 'cache'` (the default
 * for spreadsheets — they're slow-moving), the system also indexes the
 * rows as KB chunks. The KB build pipeline calls `list_rows` and emits
 * one markdown page per row; on a connector-level "refresh" event the
 * agent's KB rebuilds.
 */

import { createHash } from 'crypto'
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

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface GoogleSheetsOptions {
  clientId: string
  clientSecret: string
}

export function googleSheets(opts: GoogleSheetsOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    kind: 'google-sheets',
    displayName: 'Google Sheets',
    description:
      "Bind your agent's knowledge base or pricing/availability lookup to a live Google Sheet. Edit the sheet, and the agent picks up changes — no redeploys.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
      extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    },
    category: 'spreadsheet',
    defaultConsistencyModel: 'cache',
    // Sheets API caps OAuth-client-wide reads + writes at 300 req/min
    // each (Google's published quotas: "Read requests per minute per
    // project" and the matching write bucket). We meter the tighter of
    // the two so neither side exhausts before us.
    rateLimit: { requests: 300, windowMs: 60_000, scope: 'oauth-client' },
    capabilities: [
      {
        name: 'list_rows',
        class: 'read',
        description: 'Return rows from the connected sheet. Each row is keyed by the header cells declared at connect time.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
        },
      },
      {
        name: 'query_rows',
        class: 'read',
        description: 'Return rows matching every key=value pair in `predicate` (string equality, case-insensitive).',
        parameters: {
          type: 'object',
          properties: {
            predicate: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
          required: ['predicate'],
        },
      },
      {
        name: 'update_row',
        class: 'mutation',
        description: 'Update a row identified by `rowKey` (the value in the configured key column). Patch is a {column: newValue} map. Returns conflict if the row changed since the agent last read it.',
        cas: 'optimistic-read-verify',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            rowKey: { type: 'string', description: 'Value in the key column identifying the row to update.' },
            patch: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            expectedFingerprint: {
              type: 'string',
              description: 'Optional. The fingerprint the agent read on its last list_rows/query_rows call. If supplied and stale, the update is rejected with conflict.',
            },
          },
          required: ['rowKey', 'patch'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const meta = readSheetMeta(inv.source.metadata)
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    const rows = await fetchAllRows(accessToken, meta)
    const limit = clampLimit(inv.args.limit, 100)
    let filtered = rows
    if (inv.capabilityName === 'query_rows') {
      const predicate = (inv.args.predicate ?? {}) as Record<string, string>
      filtered = rows.filter(row => matchesPredicate(row, predicate))
    } else if (inv.capabilityName !== 'list_rows') {
      throw new Error(`google-sheets: unknown read ${inv.capabilityName}`)
    }
    const sliced = filtered.slice(0, limit)
    return {
      data: {
        rows: sliced.map(r => ({ ...r.values, _fingerprint: r.fingerprint, _rowIndex: r.rowIndex })),
        total: filtered.length,
        truncated: filtered.length > sliced.length,
      },
      etag: meta.etag, // currently undefined — Sheets values.get doesn't surface etag; row-level fingerprints are the conflict signal
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    if (inv.capabilityName !== 'update_row') {
      throw new Error(`google-sheets: unknown mutation ${inv.capabilityName}`)
    }
    const meta = readSheetMeta(inv.source.metadata)
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    const { rowKey, patch, expectedFingerprint } = inv.args as {
      rowKey: string
      patch: Record<string, string>
      expectedFingerprint?: string
    }

    // Pre-flight: read the row, compute fingerprint, compare.
    const rows = await fetchAllRows(accessToken, meta)
    const target = rows.find(r => normalizeKey(r.values[meta.keyColumn]) === normalizeKey(rowKey))
    if (!target) {
      throw new ResourceContention(
        `row with key "${rowKey}" not found`,
        [],
        { availableRows: rows.length },
      )
    }
    if (expectedFingerprint && expectedFingerprint !== target.fingerprint) {
      throw new ResourceContention(
        `row "${rowKey}" was modified since the agent last read it; re-read and try again`,
        [],
        { current: target.values, currentFingerprint: target.fingerprint },
      )
    }

    // Build the new row preserving column order.
    const updatedValues: string[] = meta.headers.map(h =>
      h in patch ? String(patch[h]) : (target.values[h] ?? ''),
    )
    const range = `${meta.sheetName}!A${target.rowIndex + 1}:${columnIndexToLetter(meta.headers.length - 1)}${target.rowIndex + 1}`
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values: [updatedValues] }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401 || res.status === 403) {
      throw new CredentialsExpired(`Google Sheets rejected token (${res.status})`, inv.source.id)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`google-sheets update_row ${res.status}: ${text.slice(0, 200)}`)
    }
    const updatedValuesByHeader = Object.fromEntries(
      meta.headers.map((h, i) => [h, updatedValues[i] ?? '']),
    )
    return {
      status: 'committed',
      data: {
        row: updatedValuesByHeader,
        fingerprint: rowFingerprint(updatedValuesByHeader),
        updatedRange: range,
      },
      etagAfter: rowFingerprint(updatedValuesByHeader),
      committedAt: Date.now(),
      idempotentReplay: false,
    }
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
      scopes: tokens.scope?.split(/\s+/) ?? SCOPES,
      // Operator must select the spreadsheet + range post-connect; we
      // can't infer it during the OAuth handshake.
      metadata: { spreadsheetId: '', sheetName: 'Sheet1', headerRow: 1, keyColumn: '' },
    }
  },

  async refreshToken(creds) {
    if (creds.kind !== 'oauth2' || !creds.refreshToken) {
      throw new Error('google-sheets.refreshToken: missing refresh token')
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
      const meta = readSheetMeta(source.metadata)
      if (!meta.spreadsheetId) {
        return { ok: false, reason: 'spreadsheetId not configured — pick a sheet in the connection settings' }
      }
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}?fields=spreadsheetId,properties.title`
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: `Google rejected token (${res.status}) — reconnect required` }
      }
      if (!res.ok) return { ok: false, reason: `Google returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

interface SheetMeta {
  spreadsheetId: string
  sheetName: string
  /** 1-indexed header row in the sheet. */
  headerRow: number
  /** Header name that uniquely identifies a row (used by update_row). */
  keyColumn: string
  /** Cached column headers — populated on first fetch. Optional in metadata
   *  because we resolve them at fetch time and write back via the route
   *  layer when the user pins the connection. */
  headers: string[]
  /** Whatever the upstream surfaces as a top-level revision identifier;
   *  if absent we synthesize per-row fingerprints instead. */
  etag?: string
}

function readSheetMeta(meta: Record<string, unknown>): SheetMeta {
  const spreadsheetId = String(meta.spreadsheetId ?? '')
  const sheetName = String(meta.sheetName ?? 'Sheet1')
  const headerRow = Number(meta.headerRow ?? 1)
  const keyColumn = String(meta.keyColumn ?? '')
  const headers = Array.isArray(meta.headers) ? (meta.headers as string[]).map(String) : []
  if (!spreadsheetId || !keyColumn) {
    throw new Error('google-sheets metadata missing spreadsheetId or keyColumn')
  }
  return { spreadsheetId, sheetName, headerRow, keyColumn, headers }
}

interface ResolvedRow {
  rowIndex: number // 0-indexed offset from the data start (NOT including header)
  values: Record<string, string>
  fingerprint: string
}

/** Fetch every row in the configured sheet/range and project to keyed
 *  records. We don't paginate — Sheets values.get returns the whole range
 *  in one call. For very wide sheets the operator can split the
 *  connection into multiple DataSources, each with a narrower range. */
async function fetchAllRows(accessToken: string, meta: SheetMeta): Promise<ResolvedRow[]> {
  const range = `${meta.sheetName}`
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(meta.spreadsheetId)}/values/${encodeURIComponent(range)}`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Google Sheets rejected token (${res.status})`, '')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`google-sheets values.get ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { values?: string[][] }
  const grid = json.values ?? []
  if (grid.length === 0) return []
  const headers = meta.headers.length > 0 ? meta.headers : grid[meta.headerRow - 1] ?? []
  if (headers.length === 0) return []
  const dataRows = grid.slice(meta.headerRow)
  return dataRows.map((rowCells, i) => {
    const values: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      values[headers[c]] = (rowCells[c] ?? '').toString()
    }
    return {
      // rowIndex is the absolute row in the sheet (1-indexed) where this
      // row's data lives. Header is at meta.headerRow. So this row is at
      // headerRow + i + 1 (1-indexed).
      rowIndex: meta.headerRow + i,
      values,
      fingerprint: rowFingerprint(values),
    }
  })
}

/** Stable fingerprint of a row's cells. Used as a synthetic etag for
 *  optimistic-read-verify CAS. */
function rowFingerprint(values: Record<string, string>): string {
  const keys = Object.keys(values).sort()
  const blob = keys.map(k => `${k}=${values[k]}`).join('')
  return createHash('sha256').update(blob).digest('hex').slice(0, 16)
}

function matchesPredicate(row: ResolvedRow, predicate: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(predicate)) {
    const cell = row.values[k]
    if (cell === undefined) return false
    if (cell.toLowerCase().trim() !== String(v).toLowerCase().trim()) return false
  }
  return true
}

function normalizeKey(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

function clampLimit(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return dflt
  return Math.min(Math.max(1, Math.floor(n)), 500)
}

function columnIndexToLetter(idx: number): string {
  // 0 → A, 25 → Z, 26 → AA, 27 → AB ...
  let n = idx
  let s = ''
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

async function ensureFreshAccessToken(creds: ConnectorCredentials, clientId: string, clientSecret: string): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('google-sheets: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Google Sheets access token expired and no refresh token', '')
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
