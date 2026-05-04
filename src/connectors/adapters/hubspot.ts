/**
 * HubSpot CRM connector — three load-bearing capabilities, picked to
 * cover the voice-agent's CRM hot path without trying to swallow all of
 * HubSpot's surface in v1.
 *
 *   find_contact(email)
 *     → {contact: {id, properties}} | {found: false}
 *     POST /crm/v3/objects/contacts/search with an email-equality filter.
 *     Cheap, idempotent, no CAS needed (read).
 *
 *   upsert_contact(email, properties)
 *     → {contactId, created}
 *     Mutation. CAS strategy = native-idempotency, BUT: HubSpot's
 *     `idempotencyKey` query param is ONLY available on the v3 *batch*
 *     endpoints (`/crm/v3/objects/contacts/batch/upsert`). The
 *     single-record endpoints don't honor it. We use the batch endpoint
 *     with a single-element array to get native idempotency on retry.
 *
 *   create_note(contactId, body)
 *     → {noteId}
 *     Mutation that logs a note engagement on a contact and associates
 *     it. Notes are append-only — there's no conflict to detect — so we
 *     use native-idempotency via the same batch trick on
 *     `/crm/v3/objects/notes/batch/create`.
 *
 * Why three and not thirty: the agent's leverage on HubSpot is
 * "remember who I just spoke to". `find_contact` lets the agent address
 * a returning caller by name; `upsert_contact` captures a new one
 * without duplicates; `create_note` writes the call's outcome as a CRM
 * activity. Anything beyond these (deals, tickets, lists) lives in
 * Tier-2 specific kinds — keeping the manifest tight keeps the agent's
 * tool registry comprehensible.
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

const SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
]
const AUTH_URL = 'https://app.hubspot.com/oauth/authorize'
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const API = 'https://api.hubapi.com'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface HubSpotOptions {
  clientId: string
  clientSecret: string
}

export function hubspot(opts: HubSpotOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const adapter: ConnectorAdapter = {
  manifest: {
    kind: 'hubspot',
    displayName: 'HubSpot CRM',
    description:
      "Look up callers in HubSpot, upsert contacts without duplicates, and log call notes as CRM activities. Three capabilities — the voice-agent's CRM hot path.",
    auth: {
      kind: 'oauth2',
      authorizationUrl: AUTH_URL,
      tokenUrl: TOKEN_URL,
      scopes: SCOPES,
      clientIdEnv: 'HUBSPOT_OAUTH_CLIENT_ID',
      clientSecretEnv: 'HUBSPOT_OAUTH_CLIENT_SECRET',
    },
    category: 'crm',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'find_contact',
        class: 'read',
        description: 'Search HubSpot contacts by email. Returns the first match or {found:false}.',
        parameters: {
          type: 'object',
          properties: { email: { type: 'string', description: 'Email to search for (case-insensitive).' } },
          required: ['email'],
        },
      },
      {
        name: 'upsert_contact',
        class: 'mutation',
        description:
          'Create-or-update a contact identified by email. Returns the contact id and a `created` flag indicating whether the row was new.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            properties: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Property map (firstname, lastname, phone, company, …).',
            },
          },
          required: ['email'],
        },
      },
      {
        name: 'create_note',
        class: 'mutation',
        description:
          'Log a note engagement against a contact. Append-only — note bodies do not conflict.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            body: { type: 'string', description: 'Note body (HTML or plain text).' },
          },
          required: ['contactId', 'body'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    if (inv.capabilityName !== 'find_contact') {
      throw new Error(`hubspot: unknown read capability ${inv.capabilityName}`)
    }
    const { email } = inv.args as { email: string }
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    const res = await fetch(`${API}/crm/v3/objects/contacts/search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: 'email', operator: 'EQ', value: email.toLowerCase() }],
          },
        ],
        properties: ['email', 'firstname', 'lastname', 'phone', 'company'],
        limit: 1,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) {
      throw new CredentialsExpired(`HubSpot rejected token (401)`, inv.source.id)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`hubspot find_contact ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      results?: Array<{ id: string; properties: Record<string, string> }>
    }
    const first = json.results?.[0]
    return {
      data: first
        ? { found: true, contact: { id: first.id, properties: first.properties } }
        : { found: false },
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const accessToken = await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret)
    if (inv.capabilityName === 'upsert_contact') {
      return upsertContact(inv, accessToken)
    }
    if (inv.capabilityName === 'create_note') {
      return createNote(inv, accessToken)
    }
    throw new Error(`hubspot: unknown mutation capability ${inv.capabilityName}`)
  },

  async exchangeOAuth(input) {
    if (!clientId || !clientSecret) {
      throw new Error('HubSpot OAuth client not configured (HUBSPOT_OAUTH_CLIENT_ID / _SECRET)')
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
      throw new Error('hubspot.refreshToken: missing refresh token')
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
      // /oauth/v1/access-tokens/{token} is the cheapest grant-validity probe.
      const res = await fetch(`${API}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return { ok: false, reason: `HubSpot rejected token (${res.status}) — reconnect required` }
      }
      if (!res.ok) return { ok: false, reason: `HubSpot returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
  }
  return adapter
}

async function upsertContact(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const { email, properties } = inv.args as { email: string; properties?: Record<string, string> }
  const idemKey = sanitizeIdempotencyKey(inv.idempotencyKey)
  // Batch-upsert is the only HubSpot endpoint that honors `idempotencyKey`.
  // See https://developers.hubspot.com/docs/api/crm/contacts batch upsert.
  const url = `${API}/crm/v3/objects/contacts/batch/upsert?idempotencyKey=${encodeURIComponent(idemKey)}`
  const body = {
    inputs: [
      {
        idProperty: 'email',
        id: email.toLowerCase(),
        properties: { email: email.toLowerCase(), ...(properties ?? {}) },
      },
    ],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired(`HubSpot rejected token (401)`, inv.source.id)
  }
  if (res.status === 409) {
    // HubSpot returns 409 when the upsert targets a record that's been
    // concurrently mutated in a way batch can't reconcile.
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hubspot upsert_contact conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot upsert_contact ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    results?: Array<{ id: string; createdAt?: string; updatedAt?: string }>
    status?: string
  }
  const first = json.results?.[0]
  if (!first) {
    throw new Error('hubspot upsert_contact: empty results array')
  }
  const created = first.createdAt && first.updatedAt && first.createdAt === first.updatedAt
  return {
    status: 'committed',
    data: { contactId: first.id, created: Boolean(created) },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createNote(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityMutationResult> {
  const { contactId, body } = inv.args as { contactId: string; body: string }
  const idemKey = sanitizeIdempotencyKey(inv.idempotencyKey)
  const url = `${API}/crm/v3/objects/notes/batch/create?idempotencyKey=${encodeURIComponent(idemKey)}`
  const payload = {
    inputs: [
      {
        properties: {
          hs_note_body: body,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [
          {
            to: { id: contactId },
            // 202 = note→contact association type id (standard HubSpot mapping)
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
          },
        ],
      },
    ],
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired(`HubSpot rejected token (401)`, inv.source.id)
  }
  if (res.status === 409) {
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hubspot create_note conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot create_note ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { results?: Array<{ id: string }> }
  const first = json.results?.[0]
  if (!first) {
    throw new Error('hubspot create_note: empty results array')
  }
  return {
    status: 'committed',
    data: { noteId: first.id },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

/** HubSpot's `idempotencyKey` requires URL-safe ASCII, ≤ 64 chars. */
function sanitizeIdempotencyKey(k: string): string {
  return k.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)
}

async function ensureFreshAccessToken(creds: ConnectorCredentials, clientId: string, clientSecret: string): Promise<string> {
  if (creds.kind !== 'oauth2') {
    throw new Error('hubspot: expected oauth2 credentials')
  }
  if (creds.accessToken && (!creds.expiresAt || creds.expiresAt > Date.now() + 60_000)) {
    return creds.accessToken
  }
  if (!creds.refreshToken) {
    throw new CredentialsExpired('HubSpot access token expired and no refresh token', '')
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
