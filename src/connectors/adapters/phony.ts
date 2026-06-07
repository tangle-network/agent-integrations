/**
 * ph0ny connector — voice agents that place real phone calls. The agent's
 * "call this number on the user's behalf and report back" surface.
 *
 * Auth: Bearer API key. ph0ny issues a single `plabs_`-prefixed key per
 * developer (created in the developer portal via POST /v1/keys); the
 * connector sends it as `Authorization: Bearer <key>` on every request.
 *
 *   list_agents(limit?, cursor?)
 *     Read. GET /v1/outbound's sibling — GET /v1/agents. Lists the
 *     developer's agents (cursor-paginated, newest first).
 *
 *   get_call(id)
 *     Read. GET /v1/outbound/:id. Fetches one outbound call row including
 *     status, transcript, and extracted fields.
 *
 *   list_calls(agentId?, limit?)
 *     Read. GET /v1/outbound. Lists recent outbound calls for the
 *     developer, optionally filtered by agentId.
 *
 *   start_outbound_call(agentId, toNumber, fromNumber, mission, …)
 *     Mutation, external effect. POST /v1/outbound/start. Places a real
 *     phone call. `userConsentRecorded` is a REQUIRED gate — ph0ny rejects
 *     the request (400 CONSENT_REQUIRED) when it is false, even with valid
 *     auth. `dryRun: true` walks every gate but stops short of the carrier
 *     fetch and the row insert, returning a `dryRunReport`.
 */

import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  CredentialsExpired,
} from '../types.js'

const API = 'https://api.ph0ny.com'

export const phonyConnector: ConnectorAdapter = {
  manifest: {
    kind: 'phony',
    displayName: 'ph0ny',
    description:
      'Place real outbound phone calls with a voice agent, then read back call status, transcript, and extracted fields. Outbound calls require recorded user consent and support a dry-run that validates the full configuration without dialing.',
    auth: {
      kind: 'api-key',
      hint: 'Paste your ph0ny API key (plabs_…). Create one in the developer portal via POST /v1/keys — it is shown once.',
    },
    category: 'comms',
    // A call's status/transcript evolve while it is live, so a fetched row
    // can be stale moments later — reads are point-in-time, not authoritative
    // truth. start_outbound_call creates a fresh, uncontended call each time
    // (cas='none', fire-and-forget external effect; no upstream CAS exists).
    defaultConsistencyModel: 'cache',
    capabilities: [
      {
        name: 'list_agents',
        class: 'read',
        description: 'List the voice agents on your ph0ny developer account (newest first).',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            cursor: { type: 'string', description: 'Pagination cursor from a prior response.' },
          },
        },
      },
      {
        name: 'get_call',
        class: 'read',
        description: 'Fetch a single outbound call by id, including status, transcript, and extracted fields.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Outbound call id returned by start_outbound_call.' },
          },
          required: ['id'],
        },
      },
      {
        name: 'list_calls',
        class: 'read',
        description: 'List recent outbound calls for the account, optionally filtered by agent.',
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Optional filter — only calls placed by this agent.' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
      {
        name: 'start_outbound_call',
        class: 'mutation',
        description:
          'Place an outbound phone call. Requires userConsentRecorded=true (the user must have explicitly authorized the call). Set dryRun=true to validate the full configuration without dialing.',
        cas: 'none',
        externalEffect: true,
        parameters: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent that will place the call (agentKind must be personal_assistant).' },
            toNumber: { type: 'string', description: 'E.164 destination, e.g. +14155551212.' },
            fromNumber: { type: 'string', description: 'E.164 caller number provisioned to your developer account.' },
            mission: {
              type: 'object',
              description: 'What the agent should accomplish on the call.',
              properties: {
                goal: { type: 'string', description: 'Plain-language objective (8–2000 chars).' },
                successSchema: { type: 'object', description: 'Optional JSON schema describing fields to extract on success.' },
                ivrHints: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional hints for navigating phone-tree / IVR menus (≤8 entries).',
                },
                maxTurns: { type: 'integer', minimum: 1, maximum: 60 },
                maxDurationMs: { type: 'integer', minimum: 30000, maximum: 1200000 },
              },
              required: ['goal'],
            },
            missionId: { type: 'string', description: 'Optional caller-supplied mission id.' },
            callerProfile: {
              type: 'object',
              properties: {
                userName: { type: 'string' },
                companyName: { type: 'string' },
              },
            },
            voiceCloneId: { type: 'string', description: 'Optional cloned-voice id to speak with.' },
            userConsentRecorded: {
              type: 'boolean',
              description: 'REQUIRED. Must be true — the user explicitly authorized this call. ph0ny rejects false.',
            },
            dryRun: {
              type: 'boolean',
              description: 'When true, validate every gate and return a dryRunReport without placing the call.',
            },
          },
          required: ['agentId', 'toNumber', 'fromNumber', 'mission', 'userConsentRecorded'],
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const token = bearerToken(inv.source.credentials)
    if (inv.capabilityName === 'list_agents') {
      const { limit, cursor } = inv.args as { limit?: number; cursor?: string }
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(1, limit ?? 20), 100)))
      if (cursor) params.set('cursor', cursor)
      const json = await getJson<{ data?: unknown[]; nextCursor?: string; hasMore?: boolean }>(
        inv,
        token,
        `${API}/v1/agents?${params.toString()}`,
        'list_agents',
      )
      return {
        data: { agents: json.data ?? [], nextCursor: json.nextCursor ?? null, hasMore: json.hasMore ?? false },
        fetchedAt: Date.now(),
      }
    }
    if (inv.capabilityName === 'get_call') {
      const { id } = inv.args as { id: string }
      const json = await getJson<{ call?: unknown }>(
        inv,
        token,
        `${API}/v1/outbound/${encodeURIComponent(id)}`,
        'get_call',
      )
      return { data: { call: json.call ?? null }, fetchedAt: Date.now() }
    }
    if (inv.capabilityName === 'list_calls') {
      const { agentId, limit } = inv.args as { agentId?: string; limit?: number }
      const params = new URLSearchParams()
      params.set('limit', String(Math.min(Math.max(1, limit ?? 20), 50)))
      if (agentId) params.set('agentId', agentId)
      const json = await getJson<{ calls?: unknown[] }>(
        inv,
        token,
        `${API}/v1/outbound?${params.toString()}`,
        'list_calls',
      )
      return { data: { calls: json.calls ?? [] }, fetchedAt: Date.now() }
    }
    throw new Error(`phony: unknown read capability ${inv.capabilityName}`)
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const token = bearerToken(inv.source.credentials)
    if (inv.capabilityName === 'start_outbound_call') {
      const args = inv.args as {
        agentId: string
        toNumber: string
        fromNumber: string
        mission: {
          goal: string
          successSchema?: Record<string, unknown>
          ivrHints?: string[]
          maxTurns?: number
          maxDurationMs?: number
        }
        missionId?: string
        callerProfile?: { userName?: string; companyName?: string }
        voiceCloneId?: string
        userConsentRecorded: boolean
        dryRun?: boolean
      }
      const payload: Record<string, unknown> = {
        agentId: args.agentId,
        toNumber: args.toNumber,
        fromNumber: args.fromNumber,
        mission: args.mission,
        userConsentRecorded: args.userConsentRecorded,
      }
      if (args.missionId !== undefined) payload.missionId = args.missionId
      if (args.callerProfile !== undefined) payload.callerProfile = args.callerProfile
      if (args.voiceCloneId !== undefined) payload.voiceCloneId = args.voiceCloneId
      if (args.dryRun !== undefined) payload.dryRun = args.dryRun

      const res = await fetch(`${API}/v1/outbound/start`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`phony start_outbound_call ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as {
        callSid: string | null
        callId: string | null
        status: string
        dryRun?: boolean
        dryRunReport?: unknown
      }
      return {
        status: 'committed',
        data: {
          callId: json.callId,
          callSid: json.callSid,
          callStatus: json.status,
          dryRun: json.dryRun ?? false,
          ...(json.dryRunReport !== undefined ? { dryRunReport: json.dryRunReport } : {}),
        },
        committedAt: Date.now(),
        idempotentReplay: false,
      }
    }
    throw new Error(`phony: unknown mutation capability ${inv.capabilityName}`)
  },

  async test(source) {
    try {
      const token = bearerToken(source.credentials)
      // GET /v1/outbound?limit=1 is the cheapest authed read that proves the
      // key is valid.
      const res = await fetch(`${API}/v1/outbound?limit=1`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status === 401) return { ok: false, reason: 'ph0ny rejected credentials (401) — reconnect required' }
      if (!res.ok) return { ok: false, reason: `ph0ny returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

function bearerToken(creds: { kind: string; apiKey?: string }): string {
  if (creds.kind !== 'api-key' || typeof creds.apiKey !== 'string' || creds.apiKey.length === 0) {
    throw new Error('phony: expected api-key credentials')
  }
  return creds.apiKey
}

async function getJson<T>(
  inv: ConnectorInvocation,
  token: string,
  url: string,
  label: string,
): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (res.status === 401) throw new CredentialsExpired('ph0ny rejected credentials (401)', inv.source.id)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`phony ${label} ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}
