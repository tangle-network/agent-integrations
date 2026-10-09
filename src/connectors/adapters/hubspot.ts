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
 *   list_new_contacts(createdAfter, limit?, after?)
 *     → {contacts: [{id, email, name, company, ...}], after}
 *     Read. The same search endpoint filtered on createdate and sorted
 *     oldest first, so a poller can pick up every contact created since
 *     its last cursor (inbound leads from forms, imports and integrations).
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

const SCOPE_CONTACTS_READ = 'crm.objects.contacts.read'
const SCOPE_CONTACTS_WRITE = 'crm.objects.contacts.write'
const SCOPE_DEALS_WRITE = 'crm.objects.deals.write'
const SCOPE_TICKETS_WRITE = 'tickets'
const SCOPES_BASE = ['oauth', SCOPE_CONTACTS_READ, SCOPE_CONTACTS_WRITE]
const AUTH_URL = 'https://app.hubspot.com/oauth/authorize'
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token'
const API = 'https://api.hubapi.com'

/** OAuth client config the factory closes over. Caller resolves these
 *  at construction time (env, DB, secret manager — package doesn't care). */
export interface HubSpotOptions {
  clientId: string
  clientSecret: string
  /** When true, request the deals + tickets write scopes at connect-time
   *  so the operator can use create_deal, update_deal_stage, create_ticket.
   *  Default false — existing connections grant only contacts.read/write
   *  and would be invalidated if these scopes were added unconditionally. */
  includeWriteScope?: boolean
}

export function hubspot(opts: HubSpotOptions): ConnectorAdapter {
  const { clientId, clientSecret } = opts
  const scopes = opts.includeWriteScope
    ? [...SCOPES_BASE, SCOPE_DEALS_WRITE, SCOPE_TICKETS_WRITE]
    : SCOPES_BASE
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
      scopes,
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
        name: 'find_contact_owner',
        class: 'read',
        description:
          'Find who owns a person in HubSpot, by email: the contact owner, else the owner of an associated company, else of the most recently updated associated deal. Returns the owner id, the level and record it came from, every level checked, and the owner\'s name and email when the connection can read owners. Never infers an owner from activity.',
        requiredScopes: [SCOPE_CONTACTS_READ],
        parameters: {
          type: 'object',
          properties: { email: { type: 'string', description: 'Email of the person (case-insensitive).' } },
          required: ['email'],
        },
      },
      {
        name: 'list_new_contacts',
        class: 'read',
        description:
          'List contacts created at or after a time, oldest first: id, email, name, company, job title, lifecycle stage, original source and creation time. Page with the returned `after` cursor.',
        requiredScopes: [SCOPE_CONTACTS_READ],
        parameters: {
          type: 'object',
          properties: {
            createdAfter: { type: 'string', description: 'ISO-8601 time; contacts created at or after it.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            after: { type: 'string', description: 'Paging cursor from a previous call.' },
          },
          required: ['createdAfter'],
        },
      },
      {
        name: 'list_new_deals',
        class: 'read',
        description:
          'List deals created at or after a time, oldest first: id, name, stage, pipeline, amount and creation time. Page with the returned `after` cursor.',
        requiredScopes: ['crm.objects.deals.read'],
        parameters: {
          type: 'object',
          properties: {
            createdAfter: { type: 'string', description: 'ISO-8601 time; deals created at or after it.' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            after: { type: 'string', description: 'Paging cursor from a previous call.' },
          },
          required: ['createdAfter'],
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
      {
        name: 'create_deal',
        class: 'mutation',
        description:
          'Create a new deal in the connected HubSpot account. Optionally associate the deal with one or more contacts at creation time via `associations.contactIds`.',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_DEALS_WRITE],
        parameters: {
          type: 'object',
          properties: {
            properties: {
              type: 'object',
              properties: {
                dealname: { type: 'string', description: 'Deal name shown in HubSpot.' },
                amount: { type: 'string', description: 'Deal amount (HubSpot stores as string).' },
                dealstage: { type: 'string', description: 'Deal stage id within the target pipeline.' },
                pipeline: { type: 'string', description: 'Pipeline id; defaults to the portal default pipeline when omitted.' },
                closedate: { type: 'string', description: 'RFC3339 / ISO8601 close date.' },
              },
              required: ['dealname'],
            },
            associations: {
              type: 'object',
              properties: {
                contactIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Contact ids to associate with the new deal.',
                },
              },
            },
          },
          required: ['properties'],
        },
      },
      {
        name: 'update_deal_stage',
        class: 'mutation',
        description:
          "Move an existing deal to a different stage. Use update_deal_stage when only the stage changes — for richer property updates, use the generic HubSpot CRM batch APIs.",
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_DEALS_WRITE],
        parameters: {
          type: 'object',
          properties: {
            dealId: { type: 'string', description: 'HubSpot deal object id.' },
            dealstage: { type: 'string', description: 'Target deal stage id.' },
          },
          required: ['dealId', 'dealstage'],
        },
      },
      {
        name: 'create_ticket',
        class: 'mutation',
        description:
          'Create a support ticket. `subject` is the only required property; `hs_pipeline_stage` and `hs_ticket_priority` default to the portal defaults when omitted.',
        cas: 'native-idempotency',
        externalEffect: true,
        requiredScopes: [SCOPE_TICKETS_WRITE],
        parameters: {
          type: 'object',
          properties: {
            properties: {
              type: 'object',
              properties: {
                subject: { type: 'string', description: 'Ticket subject / title.' },
                content: { type: 'string', description: 'Ticket body (HTML or plain text).' },
                hs_pipeline_stage: { type: 'string', description: 'Stage id within the ticket pipeline.' },
                hs_ticket_priority: {
                  type: 'string',
                  enum: ['LOW', 'MEDIUM', 'HIGH'],
                  description: 'HubSpot ticket priority enum.',
                },
              },
              required: ['subject'],
            },
          },
          required: ['properties'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    if (inv.capabilityName === 'list_new_contacts') {
      return listNewContacts(inv, await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret))
    }
    if (inv.capabilityName === 'list_new_deals') {
      return listNewDeals(inv, await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret))
    }
    if (inv.capabilityName === 'find_contact_owner') {
      return findContactOwner(inv, await ensureFreshAccessToken(inv.source.credentials, clientId, clientSecret))
    }
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
        properties: ['email', 'firstname', 'lastname', 'phone', 'company', 'hubspot_owner_id'],
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
    if (inv.capabilityName === 'create_deal') {
      return createDeal(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'update_deal_stage') {
      return updateDealStage(inv, accessToken, 15_000)
    }
    if (inv.capabilityName === 'create_ticket') {
      return createTicket(inv, accessToken, 15_000)
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
      scopes: tokens.scope?.split(/\s+/) ?? scopes,
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

async function createDeal(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    properties?: {
      dealname?: string
      amount?: string
      dealstage?: string
      pipeline?: string
      closedate?: string
    }
    associations?: { contactIds?: string[] }
  }
  if (!args.properties || typeof args.properties !== 'object') {
    throw new Error('hubspot create_deal: `properties` is required')
  }
  if (!args.properties.dealname) {
    throw new Error('hubspot create_deal: `properties.dealname` is required')
  }
  const dealProperties: Record<string, string> = { dealname: args.properties.dealname }
  if (args.properties.amount !== undefined) dealProperties.amount = args.properties.amount
  if (args.properties.dealstage !== undefined) dealProperties.dealstage = args.properties.dealstage
  if (args.properties.pipeline !== undefined) dealProperties.pipeline = args.properties.pipeline
  if (args.properties.closedate !== undefined) dealProperties.closedate = args.properties.closedate

  const payload: Record<string, unknown> = { properties: dealProperties }
  const contactIds = args.associations?.contactIds ?? []
  if (contactIds.length > 0) {
    payload.associations = contactIds.map((id) => ({
      to: { id },
      // 3 = deal→contact association type id (standard HubSpot mapping)
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
    }))
  }
  const res = await fetch(`${API}/crm/v3/objects/deals`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Tangle-Idempotency-Key': inv.idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`HubSpot rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 409) {
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hubspot create_deal conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot create_deal ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    properties?: Record<string, string>
    createdAt?: string
    updatedAt?: string
  }
  return {
    status: 'committed',
    data: {
      dealId: json.id,
      properties: json.properties ?? {},
      createdAt: json.createdAt,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function updateDealStage(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as { dealId?: string; dealstage?: string }
  if (!args.dealId) {
    throw new Error('hubspot update_deal_stage: `dealId` is required')
  }
  if (!args.dealstage) {
    throw new Error('hubspot update_deal_stage: `dealstage` is required')
  }
  const res = await fetch(
    `${API}/crm/v3/objects/deals/${encodeURIComponent(args.dealId)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        'X-Tangle-Idempotency-Key': inv.idempotencyKey,
      },
      body: JSON.stringify({ properties: { dealstage: args.dealstage } }),
      signal: AbortSignal.timeout(timeoutMs),
    },
  )
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`HubSpot rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 409) {
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hubspot update_deal_stage conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot update_deal_stage ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    properties?: Record<string, string>
    updatedAt?: string
  }
  return {
    status: 'committed',
    data: {
      dealId: json.id,
      dealstage: json.properties?.dealstage ?? args.dealstage,
      updatedAt: json.updatedAt,
    },
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function createTicket(
  inv: ConnectorInvocation,
  accessToken: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const args = (inv.args ?? {}) as {
    properties?: {
      subject?: string
      content?: string
      hs_pipeline_stage?: string
      hs_ticket_priority?: string
    }
  }
  if (!args.properties || typeof args.properties !== 'object') {
    throw new Error('hubspot create_ticket: `properties` is required')
  }
  if (!args.properties.subject) {
    throw new Error('hubspot create_ticket: `properties.subject` is required')
  }
  const ticketProperties: Record<string, string> = { subject: args.properties.subject }
  if (args.properties.content !== undefined) ticketProperties.content = args.properties.content
  if (args.properties.hs_pipeline_stage !== undefined) {
    ticketProperties.hs_pipeline_stage = args.properties.hs_pipeline_stage
  }
  if (args.properties.hs_ticket_priority !== undefined) {
    ticketProperties.hs_ticket_priority = args.properties.hs_ticket_priority
  }
  const res = await fetch(`${API}/crm/v3/objects/tickets`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'X-Tangle-Idempotency-Key': inv.idempotencyKey,
    },
    body: JSON.stringify({ properties: ticketProperties }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401 || res.status === 403) {
    throw new CredentialsExpired(`HubSpot rejected token (${res.status})`, inv.source.id)
  }
  if (res.status === 409) {
    const text = await res.text().catch(() => '')
    throw new ResourceContention(`hubspot create_ticket conflict: ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot create_ticket ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    id: string
    properties?: Record<string, string>
    createdAt?: string
  }
  return {
    status: 'committed',
    data: {
      ticketId: json.id,
      properties: json.properties ?? {},
      createdAt: json.createdAt,
    },
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

const NEW_DEAL_PROPERTIES = ['dealname', 'dealstage', 'pipeline', 'amount', 'createdate', 'hubspot_owner_id']

/** Objects created since a time, oldest first, through the CRM search endpoint. */
async function searchCreatedSince(
  inv: ConnectorInvocation,
  accessToken: string,
  object: 'contacts' | 'deals',
  properties: string[],
  label: string,
): Promise<{ results: Array<{ id: string; createdAt?: string; properties?: Record<string, string | null> }>; after: string | null }> {
  const { createdAfter, limit, after } = inv.args as { createdAfter: string; limit?: number; after?: string }
  const since = Date.parse(createdAfter)
  if (!Number.isFinite(since)) throw new Error(`hubspot ${label}: createdAfter must be an ISO-8601 time`)
  const res = await fetch(`${API}/crm/v3/objects/${object}/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'GTE', value: String(since) }] }],
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      properties,
      limit: Math.min(Math.max(limit ?? 50, 1), 100),
      ...(after ? { after } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) {
    throw new CredentialsExpired(`HubSpot rejected token (401)`, inv.source.id)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot ${label} ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    results?: Array<{ id: string; createdAt?: string; properties?: Record<string, string | null> }>
    paging?: { next?: { after?: string } }
  }
  return { results: json.results ?? [], after: json.paging?.next?.after ?? null }
}

async function listNewDeals(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityReadResult> {
  const { results, after } = await searchCreatedSince(inv, accessToken, 'deals', NEW_DEAL_PROPERTIES, 'list_new_deals')
  const deals = results.map((row) => {
    const props = row.properties ?? {}
    return {
      id: row.id,
      name: props.dealname ?? null,
      stage: props.dealstage ?? null,
      pipeline: props.pipeline ?? null,
      amount: props.amount ?? null,
      ownerId: props.hubspot_owner_id ?? null,
      createdAt: props.createdate ?? row.createdAt ?? null,
    }
  })
  return { data: { deals, after }, fetchedAt: Date.now() }
}

const NEW_CONTACT_PROPERTIES = ['email', 'firstname', 'lastname', 'company', 'jobtitle', 'lifecyclestage', 'hs_analytics_source', 'createdate']

async function listNewContacts(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityReadResult> {
  const { results, after } = await searchCreatedSince(inv, accessToken, 'contacts', NEW_CONTACT_PROPERTIES, 'list_new_contacts')
  const contacts = results.map((row) => {
    const props = row.properties ?? {}
    return {
      id: row.id,
      email: props.email ?? null,
      name: [props.firstname, props.lastname].filter(Boolean).join(' ') || null,
      company: props.company ?? null,
      jobTitle: props.jobtitle ?? null,
      lifecycleStage: props.lifecyclestage ?? null,
      source: props.hs_analytics_source ?? null,
      createdAt: props.createdate ?? row.createdAt ?? null,
    }
  })
  return {
    data: { contacts, after },
    fetchedAt: Date.now(),
  }
}

type OwnerLevel = 'contact' | 'company' | 'deal'
interface OwnerCheck { level: OwnerLevel; recordId: string | null; result: 'owner' | 'none' | 'not_found' | 'not_readable' }

async function hubspotJson(inv: ConnectorInvocation, accessToken: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) throw new CredentialsExpired(`HubSpot rejected token (401)`, inv.source.id)
  if (res.status === 403 || res.status === 404) return { status: res.status, body: null }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`hubspot find_contact_owner ${res.status}: ${text.slice(0, 200)}`)
  }
  return { status: res.status, body: await res.json() }
}

function ownerIdOf(body: unknown): string | null {
  const props = (body as { properties?: Record<string, unknown> } | null)?.properties
  const id = props?.hubspot_owner_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** The ids of a contact's associated records of one type, or null when the token cannot read them. */
async function associatedIds(inv: ConnectorInvocation, accessToken: string, contactId: string, object: 'companies' | 'deals'): Promise<string[] | null> {
  const { status, body } = await hubspotJson(inv, accessToken, `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${object}?limit=20`)
  if (status === 403) return null
  const results = (body as { results?: Array<{ toObjectId?: string | number }> } | null)?.results ?? []
  return results.map((row) => String(row.toObjectId ?? '')).filter(Boolean)
}

async function findContactOwner(inv: ConnectorInvocation, accessToken: string): Promise<CapabilityReadResult> {
  const { email } = inv.args as { email: string }
  const checked: OwnerCheck[] = []
  const done = (owner: { level: OwnerLevel; recordId: string; ownerId: string } | null, contactId: string | null) =>
    ownerDetails(inv, accessToken, owner).then((details) => ({
      data: { found: contactId !== null, contactId, owner: details, checked },
      fetchedAt: Date.now(),
    }))

  const search = await hubspotJson(inv, accessToken, '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email.toLowerCase() }] }],
      properties: ['email', 'hubspot_owner_id'],
      limit: 1,
    }),
  })
  const contact = (search.body as { results?: Array<{ id: string; properties?: Record<string, unknown> }> } | null)?.results?.[0]
  if (!contact) {
    checked.push({ level: 'contact', recordId: null, result: search.status === 403 ? 'not_readable' : 'not_found' })
    return done(null, null)
  }
  const contactOwner = ownerIdOf(contact)
  checked.push({ level: 'contact', recordId: contact.id, result: contactOwner ? 'owner' : 'none' })
  if (contactOwner) return done({ level: 'contact', recordId: contact.id, ownerId: contactOwner }, contact.id)

  for (const object of ['companies', 'deals'] as const) {
    const level: OwnerLevel = object === 'companies' ? 'company' : 'deal'
    const ids = await associatedIds(inv, accessToken, contact.id, object)
    if (ids === null) {
      checked.push({ level, recordId: null, result: 'not_readable' })
      continue
    }
    if (ids.length === 0) {
      checked.push({ level, recordId: null, result: 'not_found' })
      continue
    }
    const read = await hubspotJson(inv, accessToken, `/crm/v3/objects/${object}/batch/read`, {
      method: 'POST',
      body: JSON.stringify({ properties: ['hubspot_owner_id', 'hs_lastmodifieddate'], inputs: ids.map((id) => ({ id })) }),
    })
    if (read.status === 403) {
      checked.push({ level, recordId: null, result: 'not_readable' })
      continue
    }
    // The most recently updated record with an owner speaks for the account.
    const owned = ((read.body as { results?: Array<{ id: string; properties?: Record<string, unknown> }> } | null)?.results ?? [])
      .map((row) => ({ id: row.id, ownerId: ownerIdOf(row), updated: Date.parse(String(row.properties?.hs_lastmodifieddate ?? '')) || 0 }))
      .filter((row) => row.ownerId)
      .sort((a, b) => b.updated - a.updated)[0]
    checked.push({ level, recordId: owned?.id ?? ids[0] ?? null, result: owned ? 'owner' : 'none' })
    if (owned?.ownerId) return done({ level, recordId: owned.id, ownerId: owned.ownerId }, contact.id)
  }
  return done(null, contact.id)
}

/** The owner's name and email when the connection may read owners; the id alone otherwise. */
async function ownerDetails(inv: ConnectorInvocation, accessToken: string, owner: { level: OwnerLevel; recordId: string; ownerId: string } | null) {
  if (!owner) return null
  const { body } = await hubspotJson(inv, accessToken, `/crm/v3/owners/${encodeURIComponent(owner.ownerId)}`)
  const details = body as { email?: unknown; firstName?: unknown; lastName?: unknown } | null
  const name = [details?.firstName, details?.lastName].filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(' ')
  return {
    ...owner,
    email: typeof details?.email === 'string' ? details.email : null,
    name: name || null,
  }
}
