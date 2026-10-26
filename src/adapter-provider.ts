import type {
  CapabilityMutationResult,
  CapabilityReadResult,
  ConnectorAdapter,
  ConnectorCredentials,
  ConnectorInvocation,
  OAuth2UrlTemplateMetadataSpec,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationCatalogSource,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationProvider,
  IntegrationProviderKind,
} from './core-types.js'
import { CredentialsExpired, ProviderRateLimited, ProviderConfigError } from './connectors/types.js'
import { IntegrationError } from './core-error.js'
import { buildOAuthAuthorizationUrl, exchangeAuthorizationCode, redactOAuthSensitiveText, oauthClientCredentialRedactionValues, createOAuthBasicAuthorizationHeader } from './connectors/oauth-protocol.js'

/** OAuth client credentials the host resolves at start/exchange time.
 *  The lib never reads env or any vault — kept edge-runtime-safe. */
export interface OAuthClientCredentials {
  clientId: string
  /** Omit for public clients whose manifest uses tokenClientAuthMethod=none. */
  clientSecret?: string
  /** Business-login configuration; replaces per-request scopes. */
  configId?: string
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
  /** Resolve OAuth client_id and, for confidential clients, client_secret at
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
  /** Initial encrypted credential commit. Return the canonical reconnect id and secretRef. */
  persistConnection?: (input: { connection: IntegrationConnection; credentials: ConnectorCredentials }) => Promise<IntegrationConnection>
  /** Bounds provider work, including adapters that ignore cancellation. */
  operationTimeoutMs?: number
}

export function createConnectorAdapterProvider(options: ConnectorAdapterProviderOptions): IntegrationProvider {
  const providerId = options.id ?? 'first-party'
  const now = options.now ?? (() => new Date())
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch?.bind(globalThis) as typeof fetch | undefined)
  const adapters = new Map(options.adapters.filter((adapter) => !adapter.inboundOnly).map((adapter) => [adapter.manifest.kind, adapter]))
  const requireAdapter = (id: string) => {
    const adapter = adapters.get(id)
    if (!adapter) throw new IntegrationError(`Connector adapter ${id} not found.`, 'connector_not_found')
    if (adapter.catalogOnly) throw new IntegrationError(`Connector ${id} is not configured.`, 'config_missing')
    return adapter
  }
  const requireOAuth = (adapter: ConnectorAdapter) => {
    const auth = oauthManifestAuth(adapter.manifest.auth)
    if (!auth || (auth.grantType ?? 'authorization_code') !== 'authorization_code') {
      throw new IntegrationError(`Connector ${adapter.manifest.kind} does not support authorization-code OAuth.`, 'auth_not_supported')
    }
    return auth
  }
  const requireClient = async (connectorId: string, auth: NonNullable<ReturnType<typeof oauthManifestAuth>>) => {
    const client = await options.resolveOAuthClient?.({ connectorId })
    if (!client?.clientId || (auth.tokenClientAuthMethod !== 'none' && !client.clientSecret)) {
      throw new IntegrationError(`OAuth client credentials unavailable for ${connectorId}.`, 'config_missing')
    }
    if (auth.tokenClientAuthMethod && !['none', 'client_secret_post', 'client_secret_basic'].includes(auth.tokenClientAuthMethod)) {
      throw new IntegrationError('Unsupported OAuth token client authentication method.', 'config_missing')
    }
    return client
  }
  const commit = async (connection: IntegrationConnection, credentials: ConnectorCredentials) => {
    if (!options.persistConnection) throw new IntegrationError('An encrypted credential commit is required.', 'config_missing')
    try {
      const stored = await options.persistConnection({ connection, credentials })
      if (!stored.id || !stored.secretRef?.id || stored.owner.id !== connection.owner.id || stored.owner.type !== connection.owner.type
        || stored.providerId !== connection.providerId || stored.connectorId !== connection.connectorId) throw new Error('Invalid credential commit result.')
      return stored
    } catch (cause) { throw new IntegrationError('Credential commit rejected.', cause instanceof IntegrationError ? cause.code : 'credential_persistence_failure') }
  }
  const provider: IntegrationProvider = {
    id: providerId,
    kind: options.kind ?? 'first_party',
    listConnectors: () => [...adapters.values()].map((adapter) => manifestToConnector(providerId, adapter)),
    async startAuth(request) {
      const adapter = requireAdapter(request.connectorId)
      const auth = requireOAuth(adapter)
      const client = await requireClient(request.connectorId, auth)
      if (!auth.authorizationUrl) throw new IntegrationError('OAuth authorization URL missing.', 'config_missing')
      const metadata = resolveOAuthConnectionMetadata(auth, request.metadata, request.connectorId)
      resolveOAuthUrlTemplate(auth.tokenUrl, metadata, request.connectorId, auth.urlTemplateMetadata)
      const pkce = resolveOAuthPkceMode(auth.pkce, request.connectorId)
      const state = request.state ?? randomState()
      const requestedScopes = request.requestedScopes.length ? request.requestedScopes : auth.scopes
      return {
        providerId, connectorId: request.connectorId, state, requestedScopes,
        authUrl: buildOAuthAuthorizationUrl({
          ...auth, ...client, state, redirectUri: request.redirectUri,
          authorizationUrl: resolveOAuthUrlTemplate(auth.authorizationUrl, metadata, request.connectorId, auth.urlTemplateMetadata),
          scopes: requestedScopes,
          codeChallenge: pkce === 'unsupported' ? undefined : requirePkceChallenge(request.codeChallenge, request.connectorId),
        }),
        metadata,
      }
    },
    async completeAuth(request) {
      const adapter = requireAdapter(request.connectorId)
      const auth = requireOAuth(adapter)
      if (!request.code) throw new IntegrationError('OAuth authorization code missing.', 'config_missing')
      if (!options.persistConnection) throw new IntegrationError('An encrypted credential commit is required.', 'config_missing')
      const metadata = resolveOAuthConnectionMetadata(auth, request.metadata, request.connectorId)
      const codeVerifier = resolveOAuthPkceMode(auth.pkce, request.connectorId) === 'unsupported'
        ? undefined : requirePkceVerifier(request.codeVerifier, request.connectorId)
      // Validate both endpoints before an adapter can send the code elsewhere.
      resolveOAuthUrlTemplate(auth.tokenUrl, metadata, request.connectorId, auth.urlTemplateMetadata)
      const client = await requireClient(request.connectorId, auth)
      const exchanged = await boundedProviderCall(options.operationTimeoutMs, request.signal, async (signal) => {
        if (adapter.exchangeOAuth) return adapter.exchangeOAuth({ ...request, code: request.code!, codeVerifier, signal })
        try {
          const tokens = await exchangeAuthorizationCode({
            ...auth, ...client, code: request.code!, codeVerifier, redirectUri: request.redirectUri,
            tokenUrl: resolveOAuthUrlTemplate(auth.tokenUrl, metadata, request.connectorId, auth.urlTemplateMetadata),
            fetchImpl, signal,
          })
          return {
            credentials: { kind: 'oauth2' as const, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
              expiresAt: tokens.expiresIn && tokens.expiresIn > 0 ? now().getTime() + tokens.expiresIn * 1000 : undefined },
            scopes: tokens.scope?.split(/[\s,]+/).filter(Boolean) ?? [], metadata: tokens.metadata ?? {},
          }
        } catch (cause) {
          throw new IntegrationError(cause instanceof Error ? cause.message : 'OAuth exchange failed.', 'provider_failure')
        }
      }).catch((cause: unknown) => {
        const secrets = [request.code!, codeVerifier ?? '', ...oauthClientCredentialRedactionValues(client.clientId, client.clientSecret,
          client.clientSecret ? createOAuthBasicAuthorizationHeader(client.clientId, client.clientSecret) : undefined)]
        throw new IntegrationError(redactOAuthSensitiveText(cause instanceof Error ? cause.message : 'OAuth exchange failed.', secrets), 'provider_failure')
      })
      if (request.signal?.aborted) throw new IntegrationError('OAuth exchange aborted.', 'provider_failure')
      const credentials = exchanged.credentials
      if (credentials.kind !== 'oauth2' || !credentials.accessToken) throw new IntegrationError('OAuth exchange returned invalid credentials.', 'provider_failure')
      const issued = now().toISOString()
      return commit({
        id: randomConnectionId(), owner: request.owner, providerId, connectorId: request.connectorId,
        status: 'active', grantedScopes: exchanged.scopes.length ? exchanged.scopes : request.requestedScopes ?? [],
        createdAt: issued, updatedAt: issued,
        expiresAt: credentials.expiresAt ? new Date(credentials.expiresAt).toISOString() : undefined,
        metadata: { ...metadata, ...exchanged.metadata },
      }, credentials)
    },
    async testConnection(connection) {
      const adapter = requireAdapter(connection.connectorId)
      let source: ResolvedDataSource
      try { source = await options.resolveDataSource(connection) } catch { return 'credential_persistence_failure' }
      let observed = false
      const credentials = new Proxy(source.credentials, {
        get(target, key, receiver) { observed = true; return Reflect.get(target, key, receiver) },
        has(target, key) { observed = true; return Reflect.has(target, key) },
        ownKeys(target) { observed = true; return Reflect.ownKeys(target) },
        set(target, key, value, receiver) { observed = true; return Reflect.set(target, key, value, receiver) },
      })
      let acceptRotations = true
      let deadlineExpired = false
      let rotationFailed = false
      let persistence = Promise.resolve()
      const persistRotation = (next: ConnectorCredentials) => {
        if (!observed || !acceptRotations || deadlineExpired) return Promise.resolve()
        persistence = persistence.then(async () => {
          if (deadlineExpired) return
          try { await options.onCredentialsRotated!({ connection, credentials: next }) }
          catch { rotationFailed = true }
        })
        return persistence
      }
      let status: import('./core-types.js').IntegrationConnectionTestStatus
      try {
        const result = await boundedProviderCall(options.operationTimeoutMs, undefined, () =>
          adapter.test({ ...source, credentials }, options.onCredentialsRotated ? persistRotation : undefined),
          () => { deadlineExpired = true },
        )
        status = result.ok ? 'healthy' : classifyConnectionFailure(result.reason)
      } catch (cause) {
        if (cause instanceof ProviderOperationAborted) return 'network'
        status = classifyConnectionFailure(cause)
      } finally { acceptRotations = false }
      await persistence
      if (!observed) return 'unsupported'
      if (rotationFailed) return 'credential_persistence_failure'
      return status
    },
    async connectApiKey(request) {
      if (!request.apiKey || !options.persistConnection) throw new IntegrationError('API key and encrypted credential commit required.', 'config_missing')
      const adapter = requireAdapter(request.connectorId)
      const auth = adapter.manifest.auth.kind === 'one_of' ? adapter.manifest.auth.options : [adapter.manifest.auth]
      if (!auth.some((entry) => entry.kind === 'api-key')) throw new IntegrationError('Connector does not support API keys.', 'auth_not_supported')
      const metadata = adapter.validateConnectionMetadata ? adapter.validateConnectionMetadata(request.metadata ?? {})
        : !request.metadata || !Object.keys(request.metadata).length ? {} : null
      if (!metadata) throw new IntegrationError('Invalid connection metadata.', 'connection_metadata_invalid')
      const issued = now().toISOString()
      const connection: IntegrationConnection = {
        id: randomConnectionId(), owner: request.owner, providerId, connectorId: request.connectorId,
        status: 'active', grantedScopes: [], createdAt: issued, updatedAt: issued, metadata,
      }
      const credentials: ConnectorCredentials = { kind: 'api-key', apiKey: request.apiKey }
      const probe = createConnectorAdapterProvider({ ...options, onCredentialsRotated: undefined,
        resolveDataSource: () => ({ id: connection.id, projectId: request.owner.id, publishedAgentId: null,
          kind: request.connectorId, label: adapter.manifest.displayName, consistencyModel: adapter.manifest.defaultConsistencyModel,
          scopes: [], metadata, credentials, status: 'active' }),
      })
      const status = await probe.testConnection!(connection)
      if (status !== 'healthy') throw new IntegrationError(`Credential probe failed: ${status}.`, status === 'reconnect_required' ? 'credential_invalid'
        : status === 'rate_limited' ? 'credential_rate_limited' : status === 'unsupported' ? 'credential_probe_unsupported'
        : status === 'credential_persistence_failure' ? status : 'provider_failure')
      return commit(connection, credentials)
    },
    async invokeAction(connection, request) {
      const adapter = requireAdapter(connection.connectorId)
      const capability = adapter.manifest.capabilities.find((candidate) => candidate.name === request.action)
      if (!capability) {
        throw new IntegrationError(`Capability ${request.action} is not defined by ${connection.connectorId}.`, 'action_not_found')
      }
      const source = await options.resolveDataSource(connection)
      let rotationPersistence = Promise.resolve()
      const persistRotation = (credentials: ConnectorCredentials): Promise<void> => {
        if (!options.onCredentialsRotated) return Promise.resolve()
        rotationPersistence = rotationPersistence.then(() =>
          options.onCredentialsRotated!({ connection, credentials }),
        )
        // Some third-party adapters do not await this callback. Attach a
        // rejection observer immediately, then let the original promise keep
        // its rejection for the adapter or the provider's finally block.
        void rotationPersistence.catch(() => {})
        return rotationPersistence
      }
      const invocation: ConnectorInvocation = {
        source,
        capabilityName: request.action,
        args: toRecord(request.input),
        idempotencyKey: request.idempotencyKey ?? `idem_${connection.id}_${request.action}_${now().getTime()}`,
        expectedEtag: typeof request.metadata?.expectedEtag === 'string' ? request.metadata.expectedEtag : undefined,
        callSessionId: typeof request.metadata?.callSessionId === 'string' ? request.metadata.callSessionId : undefined,
        onCredentialsRotated: options.onCredentialsRotated
          ? persistRotation
          : undefined,
      }
      try {
        if (capability.class === 'read') {
          if (!adapter.executeRead) {
            throw new IntegrationError(`Connector ${connection.connectorId} does not implement reads.`, 'action_not_found')
          }
          const result = await adapter.executeRead(invocation)
          return readResultToAction(request, result)
        }
        if (capability.class === 'mutation') {
          if (!adapter.executeMutation) {
            throw new IntegrationError(`Connector ${connection.connectorId} does not implement mutations.`, 'action_not_found')
          }
          const result = await adapter.executeMutation(invocation)
          return mutationResultToAction(request, result)
        }
        throw new IntegrationError(`Capability ${request.action} is not invokable as an action.`, 'action_not_found')
      } finally {
        // A provider can rotate a refresh token before the requested action
        // fails. Persist that full envelope regardless of the action outcome.
        await rotationPersistence
      }
    },
  }
  return provider
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
  const primaryAuth = primaryManifestAuth(manifest.auth)
  const oauthAuth = oauthManifestAuth(manifest.auth)
  return {
    id: manifest.kind,
    providerId,
    title: manifest.displayName,
    category: mapCategory(manifest.category),
    auth: mapAuth(primaryAuth.kind),
    scopes: primaryAuth.kind === 'oauth2' ? primaryAuth.scopes : [],
    actions: manifest.capabilities
      .filter((capability) => capability.class === 'read' || capability.class === 'mutation')
      .map((capability) => ({
        id: capability.name,
        title: titleFromName(capability.name),
        risk: capability.class === 'read' ? 'read' : capability.externalEffect ? 'destructive' : 'write',
        requiredScopes: capability.requiredScopes ?? [],
        dataClass: inferDataClass(manifest.category),
        ...(capability.consistencyModel ? { consistencyModel: capability.consistencyModel } : {}),
        description: capability.description,
        approvalRequired: capability.class === 'mutation',
        inputSchema: capability.parameters,
      })),
    metadata: {
      source: 'first-party-adapter',
      supportTier: 'firstPartyExecutable',
      executable: !adapter.catalogOnly,
      oauthPkce: oauthAuth
        ? resolveOAuthPkceMode(oauthAuth.pkce, manifest.kind)
        : undefined,
      authOptions: manifest.auth.kind === 'one_of' ? manifest.auth.options.map((auth) => auth.kind) : [manifest.auth.kind],
      preferredAuth: manifest.auth.kind === 'one_of' ? manifest.auth.preferred : manifest.auth.kind,
      oauthConnectionParameters: oauthAuth ? oauthConnectionParameters(oauthAuth) : [],
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
  if (kind === 'one_of') return 'custom'
  if (kind === 'oauth2') return 'oauth2'
  if (kind === 'api-key') return 'api_key'
  if (kind === 'none') return 'none'
  return 'custom'
}

function primaryManifestAuth(auth: ConnectorAdapter['manifest']['auth']): Exclude<ConnectorAdapter['manifest']['auth'], { kind: 'one_of' }> {
  if (auth.kind !== 'one_of') return auth
  return auth.options.find((option) => option.kind === auth.preferred) ?? auth.options[0]
}

function oauthManifestAuth(auth: ConnectorAdapter['manifest']['auth']): Extract<Exclude<ConnectorAdapter['manifest']['auth'], { kind: 'one_of' }>, { kind: 'oauth2' }> | undefined {
  if (auth.kind === 'oauth2') return auth
  if (auth.kind !== 'one_of') return undefined
  return auth.options.find((option): option is Extract<typeof option, { kind: 'oauth2' }> => option.kind === 'oauth2')
}

/** Resolve the manifest value at the last possible point before an OAuth
 * request. The runtime check matters because adapters can enter through JS or
 * an `any` cast without first passing the static manifest validator. */
function resolveOAuthPkceMode(
  value: unknown,
  connectorId: string,
): 'required' | 'supported' | 'unsupported' {
  if (value === undefined || value === 'required') return 'required'
  if (value === 'supported' || value === 'unsupported') return value
  throw new IntegrationError(
    `Connector ${connectorId} has an invalid OAuth PKCE posture.`,
    'config_missing',
  )
}

function requirePkceChallenge(value: string | undefined, connectorId: string): string {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new IntegrationError(
      `OAuth PKCE S256 challenge missing or invalid for ${connectorId}.`,
      'config_missing',
    )
  }
  return value
}

function requirePkceVerifier(value: string | undefined, connectorId: string): string {
  if (!value || !/^[A-Za-z0-9._~-]{43,128}$/.test(value)) {
    throw new IntegrationError(
      `OAuth PKCE verifier missing or invalid for ${connectorId}.`,
      'config_missing',
    )
  }
  return value
}

/** Resolve provider-owned tenant labels embedded in OAuth URLs.
 *
 * Shopify and Gorgias put the merchant name in the hostname. Only one DNS
 * label is accepted for each placeholder, so connection metadata cannot turn
 * a provider URL into an arbitrary credential destination.
 */
function resolveOAuthUrlTemplate(
  template: string,
  metadata: Record<string, unknown> | undefined,
  connectorId: string,
  metadataSpecs?: Readonly<Record<string, OAuth2UrlTemplateMetadataSpec>>,
): string {
  const placeholders = [...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
  let resolved = template
  for (const match of placeholders) {
    const key = match[1]
    const raw = metadata?.[key]
    const metadataSpec = metadataSpecs?.[key]
    if (metadataSpec?.kind === 'base-url') {
      if (typeof raw !== 'string') {
        throw new IntegrationError(
          `OAuth URL for ${connectorId} requires metadata.${key} as a provider base URL.`,
          raw === undefined ? 'connection_parameters_missing' : 'connection_parameters_invalid',
        )
      }
      resolved = resolved.replaceAll(
        match[0],
        resolveOAuthMetadataBaseUrl(raw, metadataSpec, connectorId, key),
      )
      continue
    }
    if (metadataSpec?.kind === 'path-segment') {
      if (!isOAuthPathSegmentPlaceholder(template, match.index ?? -1, match[0])) {
        throw new IntegrationError(
          `OAuth URL for ${connectorId} declares metadata.${key} outside a complete path segment.`,
          'config_missing',
        )
      }
      if (typeof raw !== 'string' || !isOAuthPathSegment(raw.trim())) {
        throw new IntegrationError(
          `OAuth URL for ${connectorId} requires metadata.${key} as a valid path segment.`,
          raw === undefined ? 'connection_parameters_missing' : 'connection_parameters_invalid',
        )
      }
      resolved = resolved.replaceAll(match[0], encodeURIComponent(raw.trim()))
      continue
    }
    if (typeof raw !== 'string' || !isDnsLabel(raw.trim())) {
      throw new IntegrationError(
        `OAuth URL for ${connectorId} requires metadata.${key} as a valid tenant label.`,
        raw === undefined ? 'connection_parameters_missing' : 'connection_parameters_invalid',
      )
    }
    resolved = resolved.replaceAll(match[0], raw.trim().toLowerCase())
  }

  let url: URL
  try {
    url = new URL(resolved)
  } catch {
    throw new IntegrationError(
      `OAuth URL for ${connectorId} is invalid.`,
      'config_missing',
    )
  }
  if (url.protocol !== 'https:' || url.username || url.password || !isPublicDnsHostname(url.hostname)) {
    throw new IntegrationError(
      `OAuth URL for ${connectorId} must be HTTPS without embedded credentials.`,
      'config_missing',
    )
  }
  return url.toString()
}

function isOAuthPathSegment(value: string): boolean {
  return (
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9._~-]{1,128}$/.test(value)
  )
}

function isOAuthPathSegmentPlaceholder(
  template: string,
  index: number,
  placeholder: string,
): boolean {
  if (index < 0) return false
  const schemeIndex = template.indexOf('://')
  const rootEnd = schemeIndex >= 0
    ? schemeIndex + 3
    : template.startsWith('{')
      ? template.indexOf('}') + 1
      : 0
  const pathStart = template.indexOf('/', rootEnd)
  const end = index + placeholder.length
  const queryStart = template.search(/[?#]/)
  return (
    pathStart >= 0 &&
    index >= pathStart &&
    (queryStart < 0 || index < queryStart) &&
    template[index - 1] === '/' &&
    (end === template.length || template[end] === '/' || template[end] === '?' || template[end] === '#')
  )
}

function resolveOAuthMetadataBaseUrl(
  value: string,
  spec: Extract<OAuth2UrlTemplateMetadataSpec, { kind: 'base-url' }>,
  connectorId: string,
  metadataKey: string,
): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw invalidOAuthMetadataBaseUrl(connectorId, metadataKey)
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw invalidOAuthMetadataBaseUrl(connectorId, metadataKey)
  }
  const exactAllowed = spec.allowedBaseUrls?.some((candidate) => sameOrigin(candidate, url)) ?? false
  const suffixAllowed = spec.allowedBaseUrlSuffixes?.some((suffix) =>
    !url.port &&
    suffix.startsWith('.') &&
    url.hostname.toLowerCase().endsWith(suffix.toLowerCase())
  ) ?? false
  const hasExplicitAllowlist = Boolean(
    spec.allowedBaseUrls?.length || spec.allowedBaseUrlSuffixes?.length,
  )
  if (hasExplicitAllowlist && !exactAllowed && !suffixAllowed) {
    throw invalidOAuthMetadataBaseUrl(connectorId, metadataKey)
  }
  if (spec.requirePublicHttps && !isPublicDnsHostname(url.hostname)) {
    throw invalidOAuthMetadataBaseUrl(connectorId, metadataKey)
  }
  return url.origin
}

function invalidOAuthMetadataBaseUrl(connectorId: string, metadataKey: string): IntegrationError {
  return new IntegrationError(
    `OAuth URL for ${connectorId} requires metadata.${metadataKey} as an allowed HTTPS provider root.`,
    'connection_parameters_invalid',
  )
}

function sameOrigin(candidate: string, actual: URL): boolean {
  try {
    const allowed = new URL(candidate)
    return (
      allowed.protocol === 'https:' &&
      !allowed.username &&
      !allowed.password &&
      allowed.pathname === '/' &&
      !allowed.search &&
      !allowed.hash &&
      allowed.origin === actual.origin
    )
  } catch {
    return false
  }
}

function isPublicDnsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  ) {
    return false
  }
  // OAuth redirects to self-hosted instances require a DNS name. Reject
  // literal IP addresses because fetch cannot pin DNS against rebinding.
  if (/^[0-9.]+$/.test(normalized) || normalized.includes(':')) return false
  return normalized.includes('.') && normalized.split('.').every(isDnsLabel)
}

function isDnsLabel(value: string): boolean {
  return value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value)
}

function mapCategory(category: ConnectorAdapter['manifest']['category']): IntegrationConnector['category'] {
  if (category === 'comms') return 'chat'
  if (category === 'spreadsheet') return 'database'
  if (category === 'doc') return 'docs'
  if (category === 'commerce') return 'workflow'
  // The manifest taxonomy is richer than the hub-facade taxonomy. Sales/market
  // intelligence and HR/payroll connectors collapse to the nearest hub bucket:
  // contact/company intelligence reads like CRM; the rest have no closer fit.
  if (category === 'sales-intelligence') return 'crm'
  if (category === 'market-intelligence' || category === 'hr') return 'other'
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

class ProviderOperationAborted extends Error {}

/** The losing promise remains observed; only an on-time result reaches a credential commit. */
async function boundedProviderCall<T>(timeoutMs: number | undefined, parent: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<T>, onAbort?: () => void): Promise<T> {
  const budget = timeoutMs ?? 10_000
  if (!Number.isFinite(budget) || budget <= 0) throw new IntegrationError('Invalid provider timeout.', 'config_missing')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: (reason: Error) => void = () => {}
  const abort = () => { onAbort?.(); controller.abort(); rejectAbort(new ProviderOperationAborted('Provider operation aborted or timed out.')) }
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        rejectAbort = reject
        timer = setTimeout(abort, budget)
        parent?.addEventListener('abort', abort, { once: true })
        if (parent?.aborted) abort()
      }),
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Provider operation aborted.')
        return start(controller.signal)
      }),
    ])
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', abort)
    controller.abort()
  }
}

function classifyConnectionFailure(raw: unknown): import('./core-types.js').IntegrationConnectionTestStatus {
  if (raw instanceof ProviderRateLimited) return 'rate_limited'
  if (raw instanceof CredentialsExpired) return 'reconnect_required'
  if (raw instanceof ProviderConfigError) return 'provider_failure'
  const message = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : ''
  if (/\b429\b|rate.?limit|too many requests|\bthrottl|(?:quota|daily limit).*(?:exceed|exhaust)/i.test(message)) return 'rate_limited'
  if (/rejected credentials|credentials?.*(?:expired|invalid|revoked)|(?:access|refresh|oauth|bearer)?\s*token.*(?:expired|invalid|revoked)|invalid[_\s-]?grant|\bunauthori[sz]ed\b|authentication failed|\bhttp\s*401\b|\(401\)/i.test(message)) return 'reconnect_required'
  if (/network|fetch failed|\bECONN[A-Z]+\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bETIMEDOUT\b|socket hang up|timed?\s*out|abort(?:ed)?/i.test(message)) return 'network'
  return 'provider_failure'
}

function oauthConnectionParameters(auth: NonNullable<ReturnType<typeof oauthManifestAuth>>) {
  const placeholders = new Set([...`${auth.authorizationUrl ?? ''} ${auth.tokenUrl}`.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))
  return [...placeholders].map((key) => ({ key, required: true, kind: auth.urlTemplateMetadata?.[key]?.kind ?? 'dns-label',
    ...auth.urlTemplateMetadata?.[key] }))
}

function resolveOAuthConnectionMetadata(auth: NonNullable<ReturnType<typeof oauthManifestAuth>>, raw: Record<string, unknown> | undefined, id: string): Record<string, unknown> {
  const metadata = { ...raw }
  for (const parameter of oauthConnectionParameters(auth)) {
    const spec = auth.urlTemplateMetadata?.[parameter.key]
    if (parameter.kind !== 'dns-label') continue
    const value = metadata[parameter.key]
    if (typeof value !== 'string' || !isDnsLabel(value.trim())) throw new IntegrationError(`Invalid tenant label ${parameter.key}.`, value === undefined ? 'connection_parameters_missing' : 'connection_parameters_invalid')
    metadata[parameter.key] = value.trim().toLowerCase()
    if (spec?.kind === 'dns-label' && spec.connectionMetadata) {
      metadata[spec.connectionMetadata.key] = resolveOAuthUrlTemplate(spec.connectionMetadata.template, metadata, id, auth.urlTemplateMetadata)
    }
  }
  return metadata
}
