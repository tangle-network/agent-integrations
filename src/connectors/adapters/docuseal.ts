/**
 * @stable DocuSeal connector — e-signature flows for legal/tax agents.
 *
 * Three capabilities + inbound webhook surface:
 *
 *   create_submission(templateId, submitters, sendEmail?)
 *     → {submissionId, submitters: [{email, slug, url}], status: 'pending'}
 *     Mutation. POST /api/submissions with an explicit
 *     `external_id = idempotencyKey` so DocuSeal will dedupe the
 *     submission across our retries (verified against DocuSeal's
 *     external_id uniqueness behavior).
 *
 *   get_submission(submissionId)
 *     → {submissionId, status, completedAt?, submitters: [{email, status, completedAt?, slug, url}]}
 *     Read. GET /api/submissions/:id, normalized so the agent doesn't
 *     have to map DocuSeal's per-submitter status (`awaiting`, `sent`,
 *     `opened`, `completed`, `declined`) onto a smaller taxonomy.
 *
 *   void_submission(submissionId, reason?)
 *     → {submissionId, status: 'voided', voidedAt}
 *     Mutation. DELETE /api/submissions/:id with `reason` carried as a
 *     header. CAS: etag-if-match — DocuSeal emits an updated_at value we
 *     thread through as ETag so two concurrent voids don't race.
 *
 *   handleInboundEvent (webhook surface)
 *     DocuSeal pushes events to a customer-configured URL. We verify a
 *     HMAC-SHA256 signature over the raw body keyed by the per-account
 *     webhook secret (`X-Docuseal-Signature` header, lowercase hex). The
 *     adapter parses the event shape and emits a normalized
 *     `InboundEvent` row (eventType = `docuseal.submission.completed`,
 *     etc.). Replay protection: DocuSeal does not currently sign a
 *     timestamp, so we recommend the receiver pin a per-event-id idempotency
 *     row (the `event_id` field on every push payload).
 *
 * Auth: API key (DocuSeal personal API key — every endpoint requires it
 * via the `X-Auth-Token` header). Webhook secret is a separate
 * credential delivered via the same DataSource — we accept either
 * `kind: 'api-key'` (action surface) or `kind: 'custom'` carrying
 * `apiKey` + `webhookSecret` (action + webhook on one connection).
 *
 * Error taxonomy (mapped via integrations/errors.ts):
 *   401 → provider_auth_failed (CredentialsExpired)
 *   404 → action_not_found (Error) — submission id is unknown
 *   409 → action_denied / ResourceContention when status guards
 *   429 → provider_rate_limited (status: 'rate-limited' result)
 *   5xx → provider_unavailable
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  type ConnectorAdapter,
  type ConnectorInvocation,
  type CapabilityReadResult,
  type CapabilityMutationResult,
  type EventHandlerResult,
  type InboundEvent,
  ResourceContention,
  CredentialsExpired,
} from '../types.js'
import { firstHeader } from '../webhooks.js'

const DEFAULT_BASE = 'https://api.docuseal.com'

export interface DocuSealOptions {
  /** Override the DocuSeal API base URL (self-hosted deployments). */
  baseUrl?: string
  /** Default request timeout in ms. */
  timeoutMs?: number
}

interface DocuSealCredentials {
  apiKey: string
  webhookSecret?: string
}

function readDocuSealCredentials(creds: { kind: string; apiKey?: string; secret?: string; values?: Record<string, unknown> }): DocuSealCredentials {
  if (creds.kind === 'api-key' && typeof creds.apiKey === 'string' && creds.apiKey.length > 0) {
    return { apiKey: creds.apiKey }
  }
  if (creds.kind === 'custom' && creds.values && typeof creds.values.apiKey === 'string' && creds.values.apiKey.length > 0) {
    const webhookSecret = typeof creds.values.webhookSecret === 'string' ? creds.values.webhookSecret : undefined
    return { apiKey: creds.values.apiKey, webhookSecret }
  }
  throw new Error('docuseal: expected api-key credentials (apiKey + optional webhookSecret)')
}

export function docuseal(opts: DocuSealOptions = {}): ConnectorAdapter {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
  const timeoutMs = opts.timeoutMs ?? 30_000
  const adapter: ConnectorAdapter = {
    manifest: {
      kind: 'docuseal',
      displayName: 'DocuSeal',
      description:
        "Send documents for e-signature via DocuSeal, poll submission status, void in-flight submissions, and react to push events when submitters sign.",
      auth: {
        kind: 'api-key',
        hint: 'Paste a DocuSeal personal API key (settings → API). Optional webhook secret enables push-driven workflows.',
      },
      category: 'doc',
      defaultConsistencyModel: 'authoritative',
      capabilities: [
        {
          name: 'get_submission',
          class: 'read',
          description: 'Fetch the current status of a DocuSeal submission and each submitter.',
          parameters: {
            type: 'object',
            properties: { submissionId: { type: 'string' } },
            required: ['submissionId'],
          },
        },
        {
          name: 'create_submission',
          class: 'mutation',
          description:
            'Send a template for signature to one or more submitters. external_id is the idempotency key; retries return the original submission.',
          cas: 'native-idempotency',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              templateId: { type: 'string' },
              submitters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string' },
                    values: { type: 'object', additionalProperties: true },
                  },
                  required: ['email'],
                },
              },
              sendEmail: { type: 'boolean', default: true },
              message: { type: 'string' },
            },
            required: ['templateId', 'submitters'],
          },
        },
        {
          name: 'void_submission',
          class: 'mutation',
          description: 'Cancel an in-flight submission. CAS via updated_at — concurrent voids return ResourceContention.',
          cas: 'etag-if-match',
          externalEffect: true,
          parameters: {
            type: 'object',
            properties: {
              submissionId: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['submissionId'],
          },
        },
      ],
    },

    async executeRead(inv: ConnectorInvocation): Promise<CapabilityReadResult> {
      if (inv.capabilityName !== 'get_submission') {
        throw new Error(`docuseal: unknown read capability ${inv.capabilityName}`)
      }
      const { apiKey } = readDocuSealCredentials(inv.source.credentials)
      const { submissionId } = inv.args as { submissionId: string }
      const res = await fetch(`${baseUrl}/submissions/${encodeURIComponent(submissionId)}`, {
        headers: { 'X-Auth-Token': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401) throw new CredentialsExpired('DocuSeal rejected API key (401)', inv.source.id)
      if (res.status === 404) {
        throw new Error(`docuseal get_submission: submission ${submissionId} not found`)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`docuseal get_submission ${res.status}: ${text.slice(0, 200)}`)
      }
      const json = (await res.json()) as DocuSealSubmission
      return {
        data: normalizeSubmission(json),
        etag: json.updated_at,
        fetchedAt: Date.now(),
      }
    },

    async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
      const { apiKey } = readDocuSealCredentials(inv.source.credentials)
      if (inv.capabilityName === 'create_submission') return createSubmission(inv, apiKey, baseUrl, timeoutMs)
      if (inv.capabilityName === 'void_submission') return voidSubmission(inv, apiKey, baseUrl, timeoutMs)
      throw new Error(`docuseal: unknown mutation capability ${inv.capabilityName}`)
    },

    verifySignature({ rawBody, headers, source }) {
      const creds = (() => {
        try {
          return readDocuSealCredentials(source.credentials)
        } catch {
          return null
        }
      })()
      if (!creds?.webhookSecret) return { valid: false, reason: 'missing_webhook_secret' }
      const sig = firstHeader(headers, 'x-docuseal-signature')
      if (!sig) return { valid: false, reason: 'missing_signature_header' }
      const expected = createHmac('sha256', creds.webhookSecret).update(rawBody).digest('hex')
      const a = Buffer.from(sig.toLowerCase(), 'utf-8')
      const b = Buffer.from(expected, 'utf-8')
      if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' }
      return timingSafeEqual(a, b) ? { valid: true } : { valid: false, reason: 'invalid_signature' }
    },

    async handleInboundEvent({ rawBody }): Promise<EventHandlerResult> {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        return { events: [], response: { status: 400, body: { error: 'invalid_json' } } }
      }
      if (!parsed || typeof parsed !== 'object') {
        return { events: [], response: { status: 400, body: { error: 'invalid_payload' } } }
      }
      const evt = parsed as { event_type?: unknown; event_id?: unknown; timestamp?: unknown; data?: unknown }
      const eventType = typeof evt.event_type === 'string' ? `docuseal.${evt.event_type}` : 'docuseal.unknown'
      const providerEventId = typeof evt.event_id === 'string' ? evt.event_id : undefined
      const events: InboundEvent[] = [
        {
          eventType,
          providerEventId,
          payload: evt as Record<string, unknown>,
        },
      ]
      return { events }
    },

    async test(source) {
      try {
        const { apiKey } = readDocuSealCredentials(source.credentials)
        const res = await fetch(`${baseUrl}/templates?limit=1`, {
          headers: { 'X-Auth-Token': apiKey },
          signal: AbortSignal.timeout(8_000),
        })
        if (res.status === 401) return { ok: false, reason: 'DocuSeal rejected API key (401) — reconnect required' }
        if (!res.ok) return { ok: false, reason: `DocuSeal returned ${res.status}` }
        return { ok: true }
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
  return adapter
}

interface DocuSealSubmitter {
  id?: number
  uuid?: string
  email: string
  name?: string
  slug?: string
  status?: string
  completed_at?: string | null
  embed_src?: string
  role?: string
}

interface DocuSealSubmission {
  id: number | string
  status?: string
  external_id?: string
  updated_at?: string
  created_at?: string
  completed_at?: string | null
  submitters?: DocuSealSubmitter[]
  audit_log_url?: string
  combined_document_url?: string
}

function normalizeSubmission(s: DocuSealSubmission): Record<string, unknown> {
  return {
    submissionId: String(s.id),
    status: s.status ?? 'pending',
    updatedAt: s.updated_at,
    createdAt: s.created_at,
    completedAt: s.completed_at ?? undefined,
    auditLogUrl: s.audit_log_url,
    combinedDocumentUrl: s.combined_document_url,
    submitters: (s.submitters ?? []).map((sub) => ({
      email: sub.email,
      name: sub.name,
      role: sub.role,
      slug: sub.slug,
      status: sub.status ?? 'awaiting',
      completedAt: sub.completed_at ?? undefined,
      url: sub.embed_src,
    })),
  }
}

async function createSubmission(
  inv: ConnectorInvocation,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { templateId, submitters, sendEmail, message } = inv.args as {
    templateId: string
    submitters: Array<{ email: string; name?: string; role?: string; values?: Record<string, unknown> }>
    sendEmail?: boolean
    message?: string
  }
  const body = {
    template_id: templateId,
    external_id: inv.idempotencyKey,
    send_email: sendEmail ?? true,
    message,
    submitters: submitters.map((s) => ({
      email: s.email,
      name: s.name,
      role: s.role,
      values: s.values,
    })),
  }
  const res = await fetch(`${baseUrl}/submissions`, {
    method: 'POST',
    headers: {
      'X-Auth-Token': apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('DocuSeal rejected API key (401)', inv.source.id)
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'DocuSeal rate-limited create_submission',
    }
  }
  if (res.status === 409) {
    // External id collision — pull the original submission and surface
    // it as an idempotent replay.
    const conflictJson = (await res.json().catch(() => ({}))) as DocuSealSubmission & { submission?: DocuSealSubmission }
    const original = conflictJson.submission ?? conflictJson
    return {
      status: 'committed',
      data: normalizeSubmission(original),
      etagAfter: original.updated_at,
      committedAt: Date.now(),
      idempotentReplay: true,
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`docuseal create_submission ${res.status}: ${text.slice(0, 200)}`)
  }
  const created = (await res.json()) as DocuSealSubmission | DocuSealSubmission[]
  const sub = Array.isArray(created) ? created[0] : created
  if (!sub) {
    throw new Error('docuseal create_submission: empty response body')
  }
  return {
    status: 'committed',
    data: normalizeSubmission(sub),
    etagAfter: sub.updated_at,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}

async function voidSubmission(
  inv: ConnectorInvocation,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number,
): Promise<CapabilityMutationResult> {
  const { submissionId, reason } = inv.args as { submissionId: string; reason?: string }
  const headers: Record<string, string> = {
    'X-Auth-Token': apiKey,
    accept: 'application/json',
  }
  if (inv.expectedEtag) headers['if-match'] = inv.expectedEtag
  if (reason) headers['x-docuseal-void-reason'] = reason
  const res = await fetch(`${baseUrl}/submissions/${encodeURIComponent(submissionId)}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 401) throw new CredentialsExpired('DocuSeal rejected API key (401)', inv.source.id)
  if (res.status === 404) {
    throw new Error(`docuseal void_submission: submission ${submissionId} not found`)
  }
  if (res.status === 412) {
    throw new ResourceContention(`docuseal void_submission: submission ${submissionId} updated since last read`)
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '5')
    return {
      status: 'rate-limited',
      retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 5_000,
      message: 'DocuSeal rate-limited void_submission',
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`docuseal void_submission ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json().catch(() => ({}))) as DocuSealSubmission
  return {
    status: 'committed',
    data: {
      submissionId,
      status: 'voided',
      voidedAt: json.updated_at ?? new Date().toISOString(),
    },
    etagAfter: json.updated_at,
    committedAt: Date.now(),
    idempotentReplay: false,
  }
}
