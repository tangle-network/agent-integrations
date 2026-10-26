/**
 * Generic OAuth2 helper used by every oauth-shaped connector (Google
 * Calendar, Sheets, Drive, HubSpot, Salesforce, Zoom, ...).
 *
 * Everything PKCE-aware. Opaque-state CSRF guard. Refresh-token aware.
 * No connector-specific logic lives here — adapters hand a `clientId`,
 * `clientSecret`, `tokenUrl`, optional `extraAuthParams` and the rest is
 * mechanical.
 *
 * State and code_verifier are kept in a short-TTL flow store keyed by the
 * opaque `state` we round-trip through the provider. The default store is
 * in-memory for local/dev and tests. Production deployments should inject a
 * durable store backed by KV/Redis/D1/etc. so callbacks can land on any worker.
 */

import { createHash, randomBytes } from 'crypto'
import { buildOAuthAuthorizationUrl } from './oauth-protocol.js'
export * from './oauth-protocol.js'

import type { OAuthPkceMode } from './oauth-protocol.js'

export interface PendingOAuthFlow {
  /** code_verifier for PKCE. Absent when the provider rejects PKCE. */
  codeVerifier?: string
  /** Opaque-state value also returned in the OAuth redirect. */
  state: string
  /** Project the user is connecting under. */
  projectId: string
  /** Connector kind (e.g. 'google-calendar'). */
  kind: string
  /** Operator-supplied label that becomes DataSource.label. */
  label: string
  /** When we drop the entry. */
  expiresAt: number
  /** The redirectUri we used in the start step — must match exactly on
   *  the callback exchange. */
  redirectUri: string
}

const PENDING_TTL_MS = 10 * 60 * 1000

export interface OAuthFlowStore {
  put(state: string, flow: PendingOAuthFlow): Promise<void> | void
  consume(state: string): Promise<PendingOAuthFlow | undefined> | PendingOAuthFlow | undefined
  sweep?(now: number): Promise<void> | void
  clear?(): Promise<void> | void
}

export class InMemoryOAuthFlowStore implements OAuthFlowStore {
  private readonly pendingFlows = new Map<string, PendingOAuthFlow>()

  put(state: string, flow: PendingOAuthFlow): void {
    this.pendingFlows.set(state, flow)
  }

  consume(state: string): PendingOAuthFlow | undefined {
    const flow = this.pendingFlows.get(state)
    this.pendingFlows.delete(state)
    if (!flow || flow.expiresAt <= Date.now()) return undefined
    return flow
  }

  sweep(now: number): void {
    for (const [k, v] of this.pendingFlows) {
      if (v.expiresAt <= now) this.pendingFlows.delete(k)
    }
  }

  clear(): void {
    this.pendingFlows.clear()
  }
}

const defaultFlowStore = new InMemoryOAuthFlowStore()

export interface StartOAuthInput {
  projectId: string
  kind: string
  label: string
  authorizationUrl: string
  scopes: string[]
  /** OAuth defaults to spaces; set `,` for providers such as Zoho. */
  scopeSeparator?: ' ' | ','
  clientId: string
  /** Authorization query parameter for the client id. Defaults to
   *  `client_id`; TikTok uses `client_key`. */
  authorizationClientIdParam?: string
  /** PKCE posture. Defaults to required to preserve the existing safe flow. */
  pkce?: OAuthPkceMode
  redirectUri: string
  /** Optional extra query params; Google needs `access_type=offline` and
   *  `prompt=consent` to issue refresh tokens reliably. */
  extraAuthParams?: Record<string, string>
  /** Optional flow store. Use a durable store in distributed production
   *  runtimes; omitted means local in-memory storage. */
  store?: OAuthFlowStore
  /** Override clock for tests. */
  now?: number
}

export interface StartOAuthOutput {
  /** URL the SPA should redirect the user to. */
  authorizationUrl: string
  /** State token — caller stashes this in localStorage to verify on
   *  callback. */
  state: string
}

/** Build the authorization URL + state. SPA navigates the user there;
 *  user consents; provider redirects back to redirectUri with `code` +
 *  `state`. The caller's callback then invokes `consumePendingFlow`. */
export function startOAuthFlow(input: StartOAuthInput): StartOAuthOutput {
  const store = input.store ?? defaultFlowStore
  const now = input.now ?? Date.now()
  store.sweep?.(now)
  const usePkce = (input.pkce ?? 'required') !== 'unsupported'
  const codeVerifier = usePkce ? base64Url(randomBytes(48)) : undefined
  const codeChallenge = codeVerifier
    ? base64Url(createHash('sha256').update(codeVerifier).digest())
    : undefined
  const state = base64Url(randomBytes(24))

  store.put(state, {
    codeVerifier,
    state,
    projectId: input.projectId,
    kind: input.kind,
    label: input.label,
    redirectUri: input.redirectUri,
    expiresAt: now + PENDING_TTL_MS,
  })

  return {
    authorizationUrl: buildOAuthAuthorizationUrl({ ...input, state, codeChallenge }),
    state,
  }
}

/** Look up + remove the pending flow record. Throws if state is unknown
 *  or expired (CSRF guard / replay protection). */
export async function consumePendingFlow(state: string, store: OAuthFlowStore = defaultFlowStore): Promise<PendingOAuthFlow> {
  await store.sweep?.(Date.now())
  const flow = await store.consume(state)
  if (!flow) {
    throw new Error('Unknown or expired OAuth state: possible CSRF, replay, or stale flow')
  }
  return flow
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** Test-only — drop pending flows between unit-test runs. */
export function _resetPendingFlowsForTests(): void {
  defaultFlowStore.clear?.()
}
