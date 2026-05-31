/**
 * Microsoft Graph (identity / directory) connector.
 *
 * The Graph surface this adapter exposes is the M365 identity-and-directory
 * subset — the "who works here, in what group, with what mailbox" queries
 * an agent needs to resolve human ↔ tenant identifiers when the same user
 * is referenced across Outlook, Teams, SharePoint, and OneDrive. The
 * resource-specific surfaces (mail, calendar, chat, files) live in their
 * own adapters; this one is the directory lookup substrate they all share.
 *
 * Why read-only:
 *   Provisioning users / groups against Graph requires
 *   `User.ReadWrite.All` or `Directory.ReadWrite.All`, which Microsoft only
 *   issues under admin consent and rejects on delegated grants without an
 *   Azure AD admin approval flow. Wiring that as an agent self-service
 *   capability is a footgun, so this adapter declares no mutations. Tenants
 *   that need provisioning compose Graph + a verified app registration with
 *   their own admin consent — out of scope here.
 *
 * Auth quirks:
 *   - Same login.microsoftonline.com v2.0 endpoints as the other M365
 *     adapters (Calendar, Teams, Outlook). `offline_access` is mandatory on
 *     v2.0 to receive a refresh_token; without it the connection silently
 *     dies after the first hour.
 *   - The directory scopes (`User.Read.All`, `Group.Read.All`,
 *     `Organization.Read.All`) require tenant-admin consent. The connect
 *     flow surfaces that to the operator; a delegated grant with only
 *     `User.Read` works for the `get_me` capability but the rest 403.
 *
 * Conflict model: pure reads, no CAS. `defaultConsistencyModel:
 * 'authoritative'` because every read goes straight to the directory.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type ConnectorCredentials,
  CredentialsExpired,
} from '../types.js'
import { exchangeAuthorizationCode, refreshAccessToken } from '../oauth.js'

const SCOPES = [
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/User.Read.All',
  'https://graph.microsoft.com/Group.Read.All',
  'https://graph.microsoft.com/GroupMember.Read.All',
  'https://graph.microsoft.com/Organization.Read.All',
  // offline_access is required on v2.0 to receive a refresh_token.
  'offline_access',
]
const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GRAPH = 'https://graph.microsoft.com/v1.0'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface MicrosoftGraphOptions {
  clientId: string
  clientSecret: string
}

export function microsoftGraph(opts: MicrosoftGraphOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'microsoft-graph',
      displayName: 'Microsoft Graph (Identity & Directory)',
      description:
        "Query the Microsoft 365 directory — look up users by email, list organizations, enumerate groups, and resolve group membership. Read-only identity surface shared across the Outlook, Teams, SharePoint, and OneDrive adapters.",
      auth: {
        kind: 'oauth2',
        authorizationUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        scopes: SCOPES,
        clientIdEnv: 'MS_OAUTH_CLIENT_ID',
        clientSecretEnv: 'MS_OAUTH_CLIENT_SECRET',
      },
      category: 'other',
      defaultConsistencyModel: 'authoritative',
      capabilities: [
        {
          name: 'get_me',
          class: 'read',
          description:
            'Return the connected user (id, displayName, mail, userPrincipalName, jobTitle).',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'lookup_user',
          class: 'read',
          description:
            'Look up a Microsoft 365 user by primary email (matches mail OR userPrincipalName).',
          parameters: {
            type: 'object',
            properties: { email: { type: 'string' } },
            required: ['email'],
          },
        },
        {
          name: 'list_users',
          class: 'read',
          description:
            'List directory users, optionally narrowed by a $search prefix on displayName / mail.',
          parameters: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Optional displayName/mail prefix.' },
              top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            },
          },
        },
        {
          name: 'list_groups',
          class: 'read',
          description:
            'List Azure AD groups, optionally narrowed by a $search prefix on displayName.',
          parameters: {
            type: 'object',
            properties: {
              search: { type: 'string', description: 'Optional displayName prefix.' },
              top: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            },
          },
        },
        {
          name: 'list_group_members',
          class: 'read',
          description: 'List the user / group members of a directory group.',
          parameters: {
            type: 'object',
            properties: {
              groupId: { type: 'string' },
              top: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
            required: ['groupId'],
          },
        },
        {
          name: 'get_organization',
          class: 'read',
          description: 'Return the tenant organization record (id, displayName, verifiedDomains).',
          parameters: { type: 'object', properties: {} },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
      if (inv.capabilityName === 'get_me') {
        const json = await graphGet<{
          id: string
          displayName?: string
          mail?: string
          userPrincipalName?: string
          jobTitle?: string
        }>(`${GRAPH}/me?$select=id,displayName,mail,userPrincipalName,jobTitle`, accessToken, inv.source.id)
        return {
          data: {
            user: {
              id: json.id,
              displayName: json.displayName,
              mail: json.mail,
              userPrincipalName: json.userPrincipalName,
              jobTitle: json.jobTitle,
            },
          },
          fetchedAt: Date.now(),
        }
      }
      if (inv.capabilityName === 'lookup_user') {
        const { email } = inv.args as { email: string }
        const filter = `mail eq '${escapeOData(email)}' or userPrincipalName eq '${escapeOData(email)}'`
        const url = `${GRAPH}/users?$select=id,displayName,mail,userPrincipalName,jobTitle&$filter=${encodeURIComponent(filter)}`
        const json = await graphGet<{
          value?: Array<{
            id: string
            displayName?: string
            mail?: string
            userPrincipalName?: string
            jobTitle?: string
          }>
        }>(url, accessToken, inv.source.id)
        const user = (json.value ?? [])[0]
        if (!user) return { data: { found: false }, fetchedAt: Date.now() }
        return {
          data: {
            found: true,
            user: {
              id: user.id,
              displayName: user.displayName,
              mail: user.mail,
              userPrincipalName: user.userPrincipalName,
              jobTitle: user.jobTitle,
            },
          },
          fetchedAt: Date.now(),
        }
      }
      if (inv.capabilityName === 'list_users') {
        const { search, top } = inv.args as { search?: string; top?: number }
        const t = Math.min(Math.max(1, top ?? 25), 100)
        const params = [`$select=id,displayName,mail,userPrincipalName,jobTitle`, `$top=${t}`]
        if (search && search.length > 0) {
          // Graph $search requires the ConsistencyLevel: eventual header,
          // which we send unconditionally on this path. The format pins
          // displayName + mail, mirroring Microsoft's documented example.
          params.push(`$search=${encodeURIComponent(`"displayName:${search}" OR "mail:${search}"`)}`)
        }
        const url = `${GRAPH}/users?${params.join('&')}`
        const json = await graphGet<{
          value?: Array<{
            id: string
            displayName?: string
            mail?: string
            userPrincipalName?: string
            jobTitle?: string
          }>
        }>(url, accessToken, inv.source.id, { 'ConsistencyLevel': 'eventual' })
        const users = (json.value ?? []).map((u) => ({
          id: u.id,
          displayName: u.displayName,
          mail: u.mail,
          userPrincipalName: u.userPrincipalName,
          jobTitle: u.jobTitle,
        }))
        return { data: { users }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_groups') {
        const { search, top } = inv.args as { search?: string; top?: number }
        const t = Math.min(Math.max(1, top ?? 25), 100)
        const params = [`$select=id,displayName,description,mail,visibility`, `$top=${t}`]
        if (search && search.length > 0) {
          params.push(`$search=${encodeURIComponent(`"displayName:${search}"`)}`)
        }
        const url = `${GRAPH}/groups?${params.join('&')}`
        const json = await graphGet<{
          value?: Array<{
            id: string
            displayName?: string
            description?: string
            mail?: string
            visibility?: string
          }>
        }>(url, accessToken, inv.source.id, { 'ConsistencyLevel': 'eventual' })
        const groups = (json.value ?? []).map((g) => ({
          id: g.id,
          displayName: g.displayName,
          description: g.description,
          mail: g.mail,
          visibility: g.visibility,
        }))
        return { data: { groups }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'list_group_members') {
        const { groupId, top } = inv.args as { groupId: string; top?: number }
        const t = Math.min(Math.max(1, top ?? 50), 100)
        const url = `${GRAPH}/groups/${encodeURIComponent(groupId)}/members?$select=id,displayName,mail,userPrincipalName&$top=${t}`
        const json = await graphGet<{
          value?: Array<{
            '@odata.type'?: string
            id: string
            displayName?: string
            mail?: string
            userPrincipalName?: string
          }>
        }>(url, accessToken, inv.source.id)
        const members = (json.value ?? []).map((m) => ({
          // odata.type is '#microsoft.graph.user' | '#microsoft.graph.group'
          // | '#microsoft.graph.device' — surface as the bare suffix.
          type: m['@odata.type']?.replace('#microsoft.graph.', '') ?? 'user',
          id: m.id,
          displayName: m.displayName,
          mail: m.mail,
          userPrincipalName: m.userPrincipalName,
        }))
        return { data: { members }, fetchedAt: Date.now() }
      }
      if (inv.capabilityName === 'get_organization') {
        const json = await graphGet<{
          value?: Array<{
            id: string
            displayName?: string
            verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>
            tenantType?: string
          }>
        }>(`${GRAPH}/organization?$select=id,displayName,verifiedDomains,tenantType`, accessToken, inv.source.id)
        const org = (json.value ?? [])[0]
        if (!org) return { data: { organization: null }, fetchedAt: Date.now() }
        return {
          data: {
            organization: {
              id: org.id,
              displayName: org.displayName,
              tenantType: org.tenantType,
              verifiedDomains: (org.verifiedDomains ?? []).map((d) => ({
                name: d.name,
                isDefault: d.isDefault,
              })),
            },
          },
          fetchedAt: Date.now(),
        }
      }
      throw new Error(`microsoft-graph: unknown read capability ${inv.capabilityName}`)
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
        throw new Error('microsoft-graph.refreshToken: missing refresh token')
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
        // Cheapest call that proves the grant: GET /me. Same probe the
        // calendar and teams adapters use — all M365 grants share /me.
        const res = await fetch(`${GRAPH}/me?$select=id`, {
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

async function ensureFreshAccessToken(
  creds: ConnectorCredentials,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('microsoft-graph: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('Microsoft Graph access token expired and no refresh token', '')
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

async function graphGet<T>(
  url: string,
  accessToken: string,
  dataSourceId: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`Microsoft Graph rejected token (${res.status})`, dataSourceId)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`microsoft-graph GET ${url} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** OData $filter string-literal escape — single quotes are doubled, no
 *  other escapes apply. */
function escapeOData(value: string): string {
  return value.replace(/'/g, "''")
}
