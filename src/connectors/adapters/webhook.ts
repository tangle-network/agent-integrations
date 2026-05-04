/**
 * Universal webhook connector — the long-tail escape hatch.
 *
 * The user declares a target URL + a JSON-schema for the request body
 * the agent should send, plus an optional shared secret. We sign every
 * outbound POST with HMAC-SHA256 over `timestamp.body` and forward the
 * agent's idempotency key as a header. The receiving system enforces
 * its own idempotency.
 *
 * One adapter, two capabilities. Both arity-1 — `body` is whatever JSON
 * the agent's planner constructs from the operator-defined schema (which
 * lives in DataSource.metadata.requestSchema). The agent's planner reads
 * that schema at request time and constructs valid args.
 *
 * Why one connector covers 50 systems badly and 1 system well: the agent
 * gets a generic "send_event" tool that doesn't *know* what the upstream
 * does with the payload. That's fine for fire-and-forget event posting
 * (Zapier-style); it's wrong for booking against a calendar where you
 * need conflict-resolution. So webhook's `post_event` capability is
 * marked `cas: 'native-idempotency'` (we forward the key — the receiver
 * MUST honor it) and `defaultConsistencyModel: 'advisory'`. Anyone
 * needing real CAS uses a kind-specific connector (Calendar, Sheets, ...).
 */

import { createHmac } from 'crypto'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
} from '../types.js'

export const webhookConnector: ConnectorAdapter = {
  manifest: {
    kind: 'webhook',
    displayName: 'Webhook (custom URL)',
    description:
      "Fire signed HTTP POSTs from your agent to any URL you control. The escape hatch when there's no native connector — receive the agent's intent, run your own logic, return a result.",
    auth: { kind: 'hmac' },
    category: 'webhook',
    defaultConsistencyModel: 'advisory',
    capabilities: [
      {
        name: 'post_event',
        class: 'mutation',
        description:
          'Send a JSON event to the configured webhook URL. The receiver SHOULD return 200 on accept and 409 on conflict (the agent will offer alternatives if you include them in the response).',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          additionalProperties: true,
          description: 'Whatever JSON the operator declared at connect time. The DataSource.metadata.requestSchema is the source of truth at runtime.',
        },
      },
      {
        name: 'fetch_state',
        class: 'read',
        description: 'GET the configured webhook URL with the agent-supplied query params. Returns whatever JSON the receiver responds with.',
        parameters: {
          type: 'object',
          additionalProperties: true,
        },
      },
    ],
  },

  async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
    const url = readMetaString(inv.source.metadata, 'url')
    const params = inv.args && typeof inv.args === 'object' ? inv.args : {}
    const u = new URL(url)
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    const res = await fetch(u.toString(), {
      method: 'GET',
      headers: signHeaders(inv.source.credentials, '', inv.idempotencyKey),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`webhook fetch_state ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const data = (await res.json()) as unknown
    return {
      data,
      etag: res.headers.get('etag') ?? undefined,
      fetchedAt: Date.now(),
    }
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const url = readMetaString(inv.source.metadata, 'url')
    const body = JSON.stringify(inv.args ?? {})
    const res = await fetch(url, {
      method: 'POST',
      headers: signHeaders(inv.source.credentials, body, inv.idempotencyKey),
      body,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 409) {
      // Conflict by convention — receiver returns alternatives in the body.
      const json = (await res.json().catch(() => ({}))) as { alternatives?: unknown[]; message?: string }
      return {
        status: 'conflict',
        alternatives: json.alternatives ?? [],
        message: json.message ?? 'webhook receiver returned 409',
      }
    }
    if (!res.ok) {
      throw new Error(`webhook post_event ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const data = (await res.json().catch(() => ({}))) as unknown
    return {
      status: 'committed',
      data,
      etagAfter: res.headers.get('etag') ?? undefined,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      const url = readMetaString(source.metadata, 'url')
      // HEAD if the receiver supports it, otherwise GET. Either way a
      // non-5xx response counts as healthy — we don't validate semantics.
      const res = await fetch(url, {
        method: 'HEAD',
        headers: signHeaders(source.credentials, '', `health-${Date.now()}`),
        signal: AbortSignal.timeout(8_000),
      })
      if (res.status >= 500) return { ok: false, reason: `webhook returned ${res.status}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

function readMetaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`webhook DataSource.metadata.${key} is missing`)
  }
  return v
}

function signHeaders(
  creds: { kind: string; secret?: string; [k: string]: unknown },
  body: string,
  idempotencyKey: string,
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-phony-timestamp': ts,
    'x-phony-idempotency-key': idempotencyKey,
  }
  if (creds.kind === 'hmac' && typeof creds.secret === 'string' && creds.secret.length > 0) {
    const sig = createHmac('sha256', creds.secret).update(`${ts}.${body}`).digest('hex')
    headers['x-phony-signature'] = `sha256=${sig}`
  }
  return headers
}
