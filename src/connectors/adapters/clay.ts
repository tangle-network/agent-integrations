/**
 * Clay (clay.com) — GTM enrichment platform.
 *
 * Clay has NO general request/response REST API. Per Clay's own docs: "Clay
 * isn't built like a typical SaaS tool where you send a request to an endpoint
 * and get data back in milliseconds." The only programmatic surfaces are:
 *   1. INBOUND webhook source — POST a flat JSON row INTO a Clay table via a
 *      per-table webhook URL. This is the outbound direction for THIS connector
 *      (the agent pushes a row into Clay) and is implemented here as the
 *      `push_row` mutation.
 *   2. OUTBOUND "HTTP API" action — Clay calls an external URL the operator
 *      configures, to deliver enriched rows back out. That is the inbound
 *      direction for us and is handled by `clayWebhookProvider` in
 *      `src/webhooks/providers.ts` (Clay signs nothing, so the provider
 *      verifies a pre-shared secret header the operator configures).
 *
 * Because there is no read/enrich endpoint on standard plans, this connector
 * is intentionally write-only (ingest). The per-table webhook URL lives in
 * `DataSource.metadata.webhookUrl` (each Clay table generates its own
 * UUID-suffixed URL). The optional `x-clay-webhook-auth` token (shown once at
 * table-webhook creation) is the only Clay-native auth; if the table was
 * created without a token, requests are unauthenticated and the operator can
 * leave the credential empty. Ingest is async — the response does NOT echo
 * enriched data — so the consistency model is `advisory`.
 */

import {
  type CapabilityMutationResult,
  type ConnectorAdapter,
  type ConnectorCredentials,
  type ConnectorInvocation,
  CredentialsExpired,
} from '../types.js'

export const clayConnector: ConnectorAdapter = {
  manifest: {
    kind: 'clay',
    displayName: 'Clay',
    description:
      'Push rows into a Clay table to trigger GTM enrichment workflows. Clay has no general REST API — this sends a JSON row to your table’s inbound webhook URL; enriched results flow back out via Clay’s HTTP API action (received through the clay webhook provider).',
    auth: {
      kind: 'api-key',
      hint: 'Optional Clay table webhook token (x-clay-webhook-auth), shown once when you add a webhook source to a table. Leave blank if the table’s webhook has no token. The per-table webhook URL goes in the connection metadata as `webhookUrl`.',
    },
    category: 'crm',
    defaultConsistencyModel: 'advisory',
    capabilities: [
      {
        name: 'push_row',
        class: 'mutation',
        description:
          'Send a flat JSON object to the configured Clay table webhook URL, creating a new row. Keys map to table columns (no fixed schema). Processing is asynchronous — the response acknowledges receipt but does not return enriched data.',
        cas: 'native-idempotency',
        externalEffect: true,
        parameters: {
          type: 'object',
          additionalProperties: true,
          description:
            'Flat JSON whose keys become Clay table columns, e.g. { "firstName": "Jane", "email": "jane@acme.com", "company": "Acme" }.',
        },
      },
    ],
  },

  async executeMutation(inv: ConnectorInvocation): Promise<CapabilityMutationResult> {
    const url = readWebhookUrl(inv.source.metadata)
    const body = JSON.stringify(inv.args ?? {})
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const token = clayToken(inv.source.credentials)
    if (token) headers['x-clay-webhook-auth'] = token
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 401 || res.status === 403) {
      throw new CredentialsExpired(`Clay rejected the webhook token (${res.status})`, inv.source.id)
    }
    if (!res.ok) {
      throw new Error(`clay push_row ${res.status}: ${(await res.text().catch(() => res.statusText)).slice(0, 200)}`)
    }
    // Clay returns a small JSON ack (often {} ); ingest is async so there is no
    // enriched payload to surface here.
    const data = (await res.json().catch(() => ({}))) as unknown
    return {
      status: 'committed',
      data,
      committedAt: Date.now(),
      idempotentReplay: false,
    }
  },

  async test(source) {
    try {
      // The table webhook URL is write-only (POST ingest) — we can't probe it
      // without polluting the table, so a healthy connection is one that has a
      // syntactically valid webhook URL configured.
      readWebhookUrl(source.metadata)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  },
}

function readWebhookUrl(metadata: Record<string, unknown>): string {
  const value = metadata.webhookUrl
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('clay DataSource.metadata.webhookUrl is missing')
  }
  // Surface an invalid URL eagerly rather than failing inside fetch().
  return new URL(value).toString()
}

function clayToken(credentials: ConnectorCredentials): string | undefined {
  if (credentials.kind === 'api-key' && credentials.apiKey) return credentials.apiKey
  return undefined
}
