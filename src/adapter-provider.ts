import type {
  CapabilityMutationResult,
  CapabilityReadResult,
  ConnectorAdapter,
  ConnectorCredentials,
  ConnectorInvocation,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  CompleteAuthRequest,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationCatalogSource,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationProvider,
  IntegrationProviderKind,
  StartAuthRequest,
  StartAuthResult,
} from './core-types.js'
import { IntegrationError } from './core-error.js'

/** OAuth client credentials the host resolves at start/exchange time.
 *  The lib never reads env or any vault — kept edge-runtime-safe. */
export interface OAuthClientCredentials {
  clientId: string
  clientSecret: string
}

export interface ConnectorAdapterProviderOptions {
  id?: string
  kind?: IntegrationProviderKind
  adapters: ConnectorAdapter[]
  resolveDataSource: (connection: IntegrationConnection) => Promise<ResolvedDataSource> | ResolvedDataSource
  /** Invoked when an adapter rotates credentials during executeRead /
   *  executeMutation (e.g. an OAuth access token refreshed on expiry). The
   *  host re-encrypts + persists the rotated envelope so the next expiry
   *  does not force a reconnect. Carries the connection so the host can
   *  resolve the secretRef. */
  onCredentialsRotated?: (event: {
    connection: IntegrationConnection
    credentials: ConnectorCredentials
  }) => Promise<void> | void
  /** Resolve OAuth client_id / client_secret for an oauth2 adapter at
   *  start- and exchange-time. Host owns env, vault, and per-tenant
   *  overrides. Return null to refuse the flow (lib will throw
   *  `config_missing`). The lib never logs the secret nor includes it
   *  in thrown error messages. */
  resolveOAuthClient?: (input: { connectorId: string }) =>
    | Promise<OAuthClientCredentials | null>
    | OAuthClientCredentials
    | null
  /** Fetch implementation forwarded to the OAuth token exchange. Default
   *  is `globalThis.fetch`. Tests inject a mock. */
  fetchImpl?: typeof fetch
  now?: () => Date
}

export function createConnectorAdapterProvider(options: ConnectorAdapterProviderOptions): IntegrationProvider {
  const providerId = options.id ?? 'first-party'
  const now = options.now ?? (() => new Date())
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as typeof fetch | undefined)
  const adapters = new Map<string, ConnectorAdapter>()
  for (const adapter of options.adapters) {
    adapters.set(adapter.manifest.kind, adapter)
  }
  return {
    id: providerId,
    kind: options.kind ?? 'first_party',
    listConnectors: () => [...adapters.values()].map((adapter) => manifestToConnector(providerId, adapter)),
    async startAuth(request: StartAuthRequest): Promise<StartAuthResult> {
      const adapter = adapters.get(request.connectorId)
      if (!adapter) {
        throw new IntegrationError(
          `Connector adapter ${request.connectorId} not found.`,
          'connector_not_found',
        )
      }
      const auth = adapter.manifest.auth
      if (auth.kind !== 'oauth2') {
        throw new IntegrationError(
          `Connector ${request.connectorId} does not support OAuth2 authorization (auth kind: ${auth.kind}).`,
          'auth_not_supported',
        )
      }
      if (!options.resolveOAuthClient) {
        throw new IntegrationError(
          `OAuth client resolver missing on adapter provider; cannot start auth for ${request.connectorId}.`,
          'config_missing',
        )
      }
      const client = await options.resolveOAuthClient({ connectorId: request.connectorId })
      if (!client || !client.clientId || !client.clientSecret) {
        throw new IntegrationError(
          `OAuth client credentials unavailable for ${request.connectorId}.`,
          'config_missing',
        )
      }
      const scopes =
        request.requestedScopes && request.requestedScopes.length > 0
          ? request.requestedScopes
          : auth.scopes
      const url = new URL(auth.authorizationUrl)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', client.clientId)
      url.searchParams.set('redirect_uri', request.redirectUri)
      if (scopes.length > 0) {
        url.searchParams.set('scope', scopes.join(' '))
      }
      const state = request.state ?? randomState()
      url.searchParams.set('state', state)
      if (auth.extraAuthParams) {
        for (const [key, value] of Object.entries(auth.extraAuthParams)) {
          url.searchParams.set(key, value)
        }
      }
      return {
        providerId,
        connectorId: request.connectorId,
        authUrl: url.toString(),
        state,
        metadata: request.metadata,
      }
    },
    async completeAuth(request: CompleteAuthRequest): Promise<IntegrationConnection> {
      const adapter = adapters.get(request.connectorId)
      if (!adapter) {
        throw new IntegrationError(
          `Connector adapter ${request.connectorId} not found.`,
          'connector_not_found',
        )
      }
      const auth = adapter.manifest.auth
      if (auth.kind !== 'oauth2') {
        throw new IntegrationError(
          `Connector ${request.connectorId} does not support OAuth2 authorization (auth kind: ${auth.kind}).`,
          'auth_not_supported',
        )
      }
      if (!request.code) {
        throw new IntegrationError(
          `Authorization code missing on completeAuth for ${request.connectorId}.`,
          'config_missing',
        )
      }
      if (!options.resolveOAuthClient) {
        throw new IntegrationError(
          `OAuth client resolver missing on adapter provider; cannot complete auth for ${request.connectorId}.`,
          'config_missing',
        )
      }
      const client = await options.resolveOAuthClient({ connectorId: request.connectorId })
      if (!client || !client.clientId || !client.clientSecret) {
        throw new IntegrationError(
          `OAuth client credentials unavailable for ${request.connectorId}.`,
          'config_missing',
        )
      }
      if (!fetchImpl) {
        throw new IntegrationError(
          'No fetch implementation available; inject fetchImpl into createConnectorAdapterProvider.',
          'config_missing',
        )
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: request.code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: request.redirectUri,
      })
      let res: Response
      try {
        res = await fetchImpl(auth.tokenUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
          },
          body,
        })
      } catch (cause) {
        throw new IntegrationError(
          `OAuth token exchange transport error for ${request.connectorId}: ${(cause as Error)?.message ?? 'unknown'}`,
          'provider_failure',
        )
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new IntegrationError(
          `OAuth token exchange failed for ${request.connectorId}: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
          'provider_failure',
        )
      }
      let json: {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        scope?: string
        token_type?: string
      }
      try {
        json = await res.json()
      } catch {
        throw new IntegrationError(
          `OAuth token exchange returned non-JSON body for ${request.connectorId}.`,
          'provider_failure',
        )
      }
      if (!json.access_token) {
        throw new IntegrationError(
          `OAuth token exchange returned no access_token for ${request.connectorId}.`,
          'provider_failure',
        )
      }
      const grantedScopes = typeof json.scope === 'string' && json.scope.length > 0
        ? json.scope.split(/[\s,]+/).filter(Boolean)
        : []
      const issued = now()
      const issuedIso = issued.toISOString()
      const expiresAt = typeof json.expires_in === 'number' && json.expires_in > 0
        ? new Date(issued.getTime() + json.expires_in * 1000).toISOString()
        : undefined
      return {
        id: randomConnectionId(),
        owner: request.owner,
        providerId,
        connectorId: request.connectorId,
        status: 'active',
        grantedScopes,
        createdAt: issuedIso,
        updatedAt: issuedIso,
        expiresAt,
        metadata: request.metadata,
      }
    },
    async invokeAction(connection, request) {
      const adapter = adapters.get(connection.connectorId)
      if (!adapter) {
        throw new IntegrationError(`Connector adapter ${connection.connectorId} not found.`, 'connector_not_found')
      }
      const capability = adapter.manifest.capabilities.find((candidate) => candidate.name === request.action)
      if (!capability) {
        throw new IntegrationError(`Capability ${request.action} is not defined by ${connection.connectorId}.`, 'action_not_found')
      }
      const source = await options.resolveDataSource(connection)
      let rotated: ConnectorCredentials | undefined
      const invocation: ConnectorInvocation = {
        source,
        capabilityName: request.action,
        args: toRecord(request.input),
        idempotencyKey: request.idempotencyKey ?? `idem_${connection.id}_${request.action}_${now().getTime()}`,
        expectedEtag: typeof request.metadata?.expectedEtag === 'string' ? request.metadata.expectedEtag : undefined,
        callSessionId: typeof request.metadata?.callSessionId === 'string' ? request.metadata.callSessionId : undefined,
        onCredentialsRotated: options.onCredentialsRotated
          ? (credentials) => { rotated = credentials }
          : undefined,
      }
      const persistRotation = async () => {
        if (rotated && options.onCredentialsRotated) {
          await options.onCredentialsRotated({ connection, credentials: rotated })
        }
      }
      if (capability.class === 'read') {
        if (!adapter.executeRead) {
          throw new IntegrationError(`Connector ${connection.connectorId} does not implement reads.`, 'action_not_found')
        }
        const result = await adapter.executeRead(invocation)
        await persistRotation()
        return readResultToAction(request, result)
      }
      if (capability.class === 'mutation') {
        if (!adapter.executeMutation) {
          throw new IntegrationError(`Connector ${connection.connectorId} does not implement mutations.`, 'action_not_found')
        }
        const result = await adapter.executeMutation(invocation)
        await persistRotation()
        return mutationResultToAction(request, result)
      }
      throw new IntegrationError(`Capability ${request.action} is not invokable as an action.`, 'action_not_found')
    },
  }
}

export function adapterManifestsToConnectors(
  adapters: ConnectorAdapter[],
  providerId = 'first-party',
): IntegrationConnector[] {
  return adapters.map((adapter) => manifestToConnector(providerId, adapter))
}

export function createConnectorAdapterCatalogSource(options: {
  id?: string
  providerId?: string
  adapters: ConnectorAdapter[]
  precedence?: number
}): IntegrationCatalogSource {
  const sourceId = options.id ?? 'first-party'
  return {
    id: sourceId,
    precedence: options.precedence,
    connectors: adapterManifestsToConnectors(options.adapters, options.providerId ?? sourceId),
  }
}

export function manifestToConnector(providerId: string, adapter: ConnectorAdapter): IntegrationConnector {
  const manifest = adapter.manifest
  return {
    id: manifest.kind,
    providerId,
    title: manifest.displayName,
    category: mapCategory(manifest.category),
    auth: mapAuth(manifest.auth.kind),
    scopes: manifest.auth.kind === 'oauth2' ? manifest.auth.scopes : [],
    actions: manifest.capabilities
      .filter((capability) => capability.class === 'read' || capability.class === 'mutation')
      .map((capability) => ({
        id: capability.name,
        title: titleFromName(capability.name),
        risk: capability.class === 'read' ? 'read' : capability.externalEffect ? 'destructive' : 'write',
        requiredScopes: capability.requiredScopes ?? [],
        dataClass: inferDataClass(manifest.category),
        description: capability.description,
        approvalRequired: capability.class === 'mutation',
        inputSchema: capability.parameters,
      })),
    metadata: {
      source: 'first-party-adapter',
      supportTier: 'firstPartyExecutable',
      executable: true,
    },
  }
}

function readResultToAction(request: IntegrationActionRequest, result: CapabilityReadResult): IntegrationActionResult {
  return {
    ok: true,
    action: request.action,
    output: result.data,
    metadata: {
      etag: result.etag,
      fetchedAt: result.fetchedAt,
    },
  }
}

function mutationResultToAction(request: IntegrationActionRequest, result: CapabilityMutationResult): IntegrationActionResult {
  if (result.status === 'committed') {
    return {
      ok: true,
      action: request.action,
      output: result.data,
      metadata: {
        etagAfter: result.etagAfter,
        committedAt: result.committedAt,
        idempotentReplay: result.idempotentReplay,
      },
    }
  }
  if (result.status === 'conflict') {
    return {
      ok: false,
      action: request.action,
      output: {
        conflict: true,
        message: result.message,
        alternatives: result.alternatives,
        currentState: result.currentState,
      },
    }
  }
  return {
    ok: false,
    action: request.action,
    output: {
      rateLimited: true,
      retryAfterMs: result.retryAfterMs,
      message: result.message,
    },
  }
}

function mapAuth(kind: ConnectorAdapter['manifest']['auth']['kind']): IntegrationConnector['auth'] {
  if (kind === 'oauth2') return 'oauth2'
  if (kind === 'api-key') return 'api_key'
  if (kind === 'none') return 'none'
  return 'custom'
}

function mapCategory(category: ConnectorAdapter['manifest']['category']): IntegrationConnector['category'] {
  if (category === 'comms') return 'chat'
  if (category === 'spreadsheet') return 'database'
  if (category === 'doc') return 'docs'
  if (category === 'commerce') return 'workflow'
  return category === 'other' ? 'other' : category
}

function inferDataClass(category: ConnectorAdapter['manifest']['category']): 'public' | 'internal' | 'private' | 'sensitive' {
  if (category === 'commerce') return 'sensitive'
  if (category === 'webhook') return 'internal'
  return 'private'
}

function titleFromName(name: string): string {
  return name
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function toRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  return {}
}

function randomState(): string {
  // 192 bits of entropy — comfortable CSRF margin and stays URL-safe.
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

function randomConnectionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `conn_${globalThis.crypto.randomUUID().replace(/-/g, '')}`
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return `conn_${base64UrlEncode(bytes)}`
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // btoa is defined in browsers, workers, and Node ≥ 16.
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
