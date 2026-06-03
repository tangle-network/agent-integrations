import { IntegrationRuntimeError, normalizeIntegrationError } from './errors.js'

/**
 * Self-service external-apps client — the brokered hub-exec path.
 *
 * The operator-allowlist-free way to integrate the Tangle hub (no `TRUSTED_APPS`
 * entry): a product registers itself ONCE (`registerApp` → client_id/secret),
 * the end user consents ONCE per connection from their Tangle session (a browser
 * step — not done here), and the product then mints short-lived
 * `sk-tan-broker-…` tokens unattended (`mintBrokerToken`) for each
 * `/v1/hub/exec` call. The durable grant means only the first consent needs a
 * user; everything after is app-credential-only.
 *
 * Sits alongside {@link TangleIntegrationsClient} in the integrations/hub SDK —
 * same `endpoint` + `fetchImpl` shape and the same `IntegrationRuntimeError`
 * surface. Endpoints (platform API, e.g. https://id.tangle.tools):
 *   POST /v1/apps                                      register (owner bearer)
 *   GET  /v1/apps                                      list (owner bearer)
 *   POST /v1/apps/:appId/revoke                        revoke (owner bearer)
 *   POST /v1/apps/grants/:grantId/mint-broker-token    durable re-mint (app creds)
 *   POST /v1/apps/oauth/token                          authorization_code → token
 */

export interface TangleAppsClientOptions {
  /** Platform base URL (e.g. https://id.tangle.tools). */
  endpoint: string
  /** Test seam. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch
}

export interface RegisterAppInput {
  name: string
  redirectUris: string[]
  allowedScopes: string[]
  homepageUrl?: string
}

export interface AppSummary {
  id: string
  clientId: string
  name: string
  redirectUris: string[]
  allowedScopes: string[]
  homepageUrl?: string
  createdAt?: string
}

export interface RegisteredApp extends AppSummary {
  /** Shown ONCE at registration — persist it as a secret immediately. */
  clientSecret: string
}

export interface BrokerToken {
  /** The `sk-tan-broker-…` bearer for a single `/v1/hub/exec` call. */
  accessToken: string
  expiresIn: number
  scope: string
  connectionId?: string
}

interface PlatformEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string } | string
}

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  connection_id?: string
}

export class TangleAppsClient {
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch

  constructor(options: TangleAppsClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /**
   * Register a product as an app (ONE-TIME, with the owner's bearer — a Tangle
   * session or `sk-tan-*` key). Returns the client_id + the once-shown
   * client_secret; persist the secret immediately (never retrievable again).
   */
  async registerApp(input: RegisterAppInput, ownerBearer: string): Promise<RegisteredApp> {
    const data = await this.request<{ app: AppSummary; clientSecret: string }>(
      'POST',
      '/v1/apps',
      input,
      ownerBearer,
    )
    return { ...data.app, clientSecret: data.clientSecret }
  }

  /** List the caller's registered apps (no secrets). */
  async listApps(ownerBearer: string): Promise<AppSummary[]> {
    const data = await this.request<{ apps: AppSummary[] }>('GET', '/v1/apps', undefined, ownerBearer)
    return data.apps ?? []
  }

  /** Revoke an app and cascade-kill its grants + tokens. */
  revokeApp(appId: string, ownerBearer: string): Promise<{ revoked: boolean }> {
    return this.request('POST', `/v1/apps/${encodeURIComponent(appId)}/revoke`, {}, ownerBearer)
  }

  /**
   * Durable re-mint: mint a fresh single-use `sk-tan-broker-` token against an
   * existing consented grant using ONLY the app credentials — no user session,
   * no `agc_` code. The runtime path: one call per `/v1/hub/exec`.
   */
  async mintBrokerToken(input: {
    clientId: string
    clientSecret: string
    grantId: string
    ttlSeconds?: number
  }): Promise<BrokerToken> {
    const data = await this.request<TokenResponse>(
      'POST',
      `/v1/apps/grants/${encodeURIComponent(input.grantId)}/mint-broker-token`,
      {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_id: input.grantId,
        ...(input.ttlSeconds ? { ttl_seconds: input.ttlSeconds } : {}),
      },
    )
    return toBrokerToken(data)
  }

  /**
   * Exchange an `agc_` authorization code (from the user's one-time consent)
   * for the first broker token + the durable grant. Use on the consent
   * callback; afterward `mintBrokerToken` is enough.
   */
  async exchangeAuthCode(input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
    connectionId?: string
  }): Promise<BrokerToken> {
    const data = await this.request<TokenResponse>('POST', '/v1/apps/oauth/token', {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      ...(input.connectionId ? { connection_id: input.connectionId } : {}),
    })
    return toBrokerToken(data)
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<T> {
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (bearer) headers.authorization = `Bearer ${bearer}`
      if (body !== undefined) headers['content-type'] = 'application/json'

      const response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const json = (await response.json().catch(() => undefined)) as PlatformEnvelope<T> | undefined

      if (!response.ok || (json && json.success === false)) {
        const platformCode = json?.error && typeof json.error === 'object' ? json.error.code : undefined
        const message =
          (json?.error && typeof json.error === 'object' && json.error.message) ||
          (typeof json?.error === 'string' ? json.error : `Tangle apps request failed (HTTP ${response.status})`)
        throw new IntegrationRuntimeError({
          code: platformCode === 'BROKER_DISABLED' ? 'passthrough_disabled' : 'unknown',
          message,
          status: response.status,
          metadata: { platformCode, path },
        })
      }
      // The /v1/apps surface wraps in { success, data }; /v1/apps/oauth/token is flat.
      return ((json && 'data' in json ? json.data : json) ?? ({} as T)) as T
    } catch (error) {
      if (error instanceof IntegrationRuntimeError) throw error
      const normalized = normalizeIntegrationError(error)
      throw new IntegrationRuntimeError({
        code: normalized.code,
        message: normalized.message,
        metadata: { path, userAction: normalized.userAction },
      })
    }
  }
}

export function createTangleAppsClient(options: TangleAppsClientOptions): TangleAppsClient {
  return new TangleAppsClient(options)
}

function toBrokerToken(data: TokenResponse): BrokerToken {
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: data.scope,
    connectionId: data.connection_id,
  }
}
