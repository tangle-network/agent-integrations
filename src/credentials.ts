import { createConnectorAdapterProvider, type ConnectorAdapterProviderOptions } from './adapter-provider.js'
import type {
  ConnectorAdapter,
  ConnectorCredentials,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  IntegrationConnection,
  IntegrationConnectionStore,
  IntegrationCredentialsRotatedEvent,
  IntegrationOAuthState,
  IntegrationOAuthStateOutcome,
  IntegrationOAuthStateStore,
  IntegrationProvider,
  IntegrationSecretStore,
  SecretRef,
} from './core-types.js'

export type {
  IntegrationOAuthState,
  IntegrationOAuthStateOutcome,
  IntegrationOAuthStateStore,
  IntegrationSecretStore,
}

export interface ConnectionCredentialResolverOptions {
  secrets: IntegrationSecretStore
  connections?: IntegrationConnectionStore
  adapters?: ConnectorAdapter[]
  now?: () => Date
  markConnectionError?: (connection: IntegrationConnection, error: Error) => Promise<void> | void
}

interface CredentialRefreshFlight {
  promise: Promise<ConnectorCredentials>
  cancelled: boolean
  settled: boolean
  waiters: number
}

interface CredentialPersistenceLease {
  cancelled: boolean
}

class CredentialRefreshRevokedError extends Error {
  constructor() {
    super('Connection was revoked during credential refresh.')
    this.name = 'CredentialRefreshRevokedError'
  }
}

const credentialRefreshes = new WeakMap<
  IntegrationSecretStore,
  Map<string, CredentialRefreshFlight>
>()
const credentialPersistences = new WeakMap<
  IntegrationSecretStore,
  Map<string, Set<CredentialPersistenceLease>>
>()
const credentialRevocations = new WeakMap<IntegrationSecretStore, Map<string, number>>()

export class InMemoryIntegrationSecretStore implements IntegrationSecretStore {
  private readonly secrets = new Map<string, ConnectorCredentials>()

  get(ref: SecretRef): ConnectorCredentials | undefined {
    return this.secrets.get(secretKey(ref))
  }

  put(ref: SecretRef, credentials: ConnectorCredentials): void {
    this.secrets.set(secretKey(ref), credentials)
  }

  delete(ref: SecretRef): void {
    this.secrets.delete(secretKey(ref))
  }
}

/** Test/dev double for {@link IntegrationOAuthStateStore}. Production hubs
 *  inject a durable implementation; this one keeps records in a Map and
 *  enforces the single-use + expiry contract. */
export class InMemoryIntegrationOAuthStateStore implements IntegrationOAuthStateStore {
  private readonly states = new Map<string, IntegrationOAuthState>()

  put(state: IntegrationOAuthState): void {
    this.states.set(state.state, state)
  }

  consume(state: string): IntegrationOAuthStateOutcome {
    const record = this.states.get(state)
    this.states.delete(state)
    if (!record) return { ok: false, reason: 'unknown' }
    if (record.expiresAt <= Date.now()) return { ok: false, reason: 'expired' }
    return { ok: true, state: record }
  }

  sweep(now: number): void {
    for (const [key, record] of this.states) {
      if (record.expiresAt <= now) this.states.delete(key)
    }
  }
}

export function createConnectionCredentialResolver(options: ConnectionCredentialResolverOptions) {
  const now = options.now ?? (() => new Date())
  return async function resolveDataSource(connection: IntegrationConnection): Promise<ResolvedDataSource> {
    const credentials = await resolveConnectionCredentials(connection, {
      secrets: options.secrets,
      connections: options.connections,
      adapters: options.adapters,
      now,
      markConnectionError: options.markConnectionError,
    })
    return {
      id: connection.id,
      projectId: String(connection.metadata?.projectId ?? connection.owner.id),
      publishedAgentId: typeof connection.metadata?.publishedAgentId === 'string' ? connection.metadata.publishedAgentId : null,
      kind: connection.connectorId,
      label: connection.account?.displayName ?? connection.account?.email ?? connection.connectorId,
      consistencyModel: typeof connection.metadata?.consistencyModel === 'string' ? connection.metadata.consistencyModel as never : 'authoritative',
      scopes: connection.grantedScopes,
      metadata: connection.metadata ?? {},
      credentials,
      status: connection.status === 'active' ? 'active' : connection.status === 'revoked' ? 'revoked' : 'error',
    }
  }
}

export async function resolveConnectionCredentials(input: IntegrationConnection, options: ConnectionCredentialResolverOptions): Promise<ConnectorCredentials> {
  if (input.status !== 'active') throw new Error(`Connection ${input.id} is ${input.status}.`)
  if (!input.secretRef) return { kind: 'none' }
  const now = options.now ?? (() => new Date())
  const current = await options.secrets.get(input.secretRef)
  if (!current) throw new Error(`Secret ${input.secretRef.provider}/${input.secretRef.id} not found.`)
  if (!isExpiredOauth(current, now)) return current

  const adapter = options.adapters?.find((candidate) => candidate.manifest.kind === input.connectorId)
  if (!adapter?.refreshToken) return current
  let refresh: CredentialRefreshFlight | undefined
  try {
    await assertCredentialRefreshActive(input, options, now)
    refresh = acquireCredentialRefresh({
      connectorId: input.connectorId,
      secretRef: input.secretRef,
      secrets: options.secrets,
      now,
      refreshToken: adapter.refreshToken.bind(adapter),
    })
    const refreshed = await refresh.promise
    await assertCredentialRefreshActive(input, options, now, refresh)
    if (options.connections) {
      await options.connections.put({
        ...input,
        status: 'active',
        updatedAt: now().toISOString(),
        expiresAt: refreshed.kind === 'oauth2' && refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : input.expiresAt,
      })
      await assertCredentialRefreshActive(input, options, now, refresh)
    }
    return refreshed
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Credential refresh failed.')
    if (err instanceof CredentialRefreshRevokedError) throw err
    await options.markConnectionError?.(input, err)
    if (options.connections) {
      await options.connections.put({
        ...input,
        status: 'expired',
        updatedAt: now().toISOString(),
      })
    }
    throw err
  } finally {
    if (refresh) {
      releaseCredentialRefresh(
        options.secrets,
        input.connectorId,
        input.secretRef,
        refresh,
      )
    }
  }
}

function acquireCredentialRefresh(input: {
  connectorId: string
  secretRef: SecretRef
  secrets: IntegrationSecretStore
  now: () => Date
  refreshToken: (credentials: ConnectorCredentials) => Promise<ConnectorCredentials>
}): CredentialRefreshFlight {
  let refreshes = credentialRefreshes.get(input.secrets)
  if (!refreshes) {
    refreshes = new Map()
    credentialRefreshes.set(input.secrets, refreshes)
  }
  const key = credentialRefreshKey(input.connectorId, input.secretRef)
  if (credentialRevocations.get(input.secrets)?.has(key)) {
    throw new CredentialRefreshRevokedError()
  }
  const existing = refreshes.get(key)
  if (existing) {
    existing.waiters += 1
    return existing
  }

  let flight: CredentialRefreshFlight
  const promise = Promise.resolve().then(async () => {
    // A prior refresh can settle between the caller's first read and this
    // flight. Re-read before redeeming a provider's rotating refresh token.
    const latest = await input.secrets.get(input.secretRef)
    if (!latest) {
      throw new Error(
        `Secret ${input.secretRef.provider}/${input.secretRef.id} not found.`,
      )
    }
    if (!isExpiredOauth(latest, input.now)) return latest
    const refreshed = await input.refreshToken(latest)
    if (flight.cancelled) throw new CredentialRefreshRevokedError()
    await input.secrets.put(input.secretRef, refreshed)
    if (flight.cancelled) {
      await input.secrets.delete?.(input.secretRef)
      throw new CredentialRefreshRevokedError()
    }
    return refreshed
  })
  flight = {
    promise,
    cancelled: false,
    settled: false,
    waiters: 1,
  }
  refreshes.set(key, flight)

  const settle = () => {
    flight.settled = true
    clearCredentialRefresh(input.secrets, key, flight)
  }
  // Observe rejection immediately. Every caller still receives the original
  // rejected promise and applies its connection-specific error transition.
  void promise.then(settle, settle)
  return flight
}

function releaseCredentialRefresh(
  secrets: IntegrationSecretStore,
  connectorId: string,
  secretRef: SecretRef,
  flight: CredentialRefreshFlight,
): void {
  flight.waiters -= 1
  clearCredentialRefresh(
    secrets,
    credentialRefreshKey(connectorId, secretRef),
    flight,
  )
}

function clearCredentialRefresh(
  secrets: IntegrationSecretStore,
  key: string,
  flight: CredentialRefreshFlight,
): void {
  if (!flight.settled || flight.waiters !== 0) return
  const refreshes = credentialRefreshes.get(secrets)
  if (refreshes?.get(key) !== flight) return
  refreshes.delete(key)
  if (refreshes.size === 0) credentialRefreshes.delete(secrets)
}

async function assertCredentialRefreshActive(
  input: IntegrationConnection,
  options: ConnectionCredentialResolverOptions,
  now: () => Date,
  operation?: CredentialPersistenceLease,
): Promise<void> {
  const key = input.secretRef
    ? credentialRefreshKey(input.connectorId, input.secretRef)
    : undefined
  let revoked = operation?.cancelled === true
    || (key !== undefined
      && credentialRevocations.get(options.secrets)?.has(key) === true)
  let stored: IntegrationConnection | undefined
  if (options.connections) {
    stored = await options.connections.get(input.id)
    revoked ||= stored?.status === 'revoked'
  }
  if (!revoked && input.secretRef) {
    revoked = await options.secrets.get(input.secretRef) === undefined
  }
  if (!revoked) return

  if (operation) operation.cancelled = true
  if (input.secretRef) await options.secrets.delete?.(input.secretRef)
  if (options.connections && stored?.status !== 'revoked') {
    await options.connections.put({
      ...(stored ?? input),
      status: 'revoked',
      updatedAt: now().toISOString(),
    })
  }
  throw new CredentialRefreshRevokedError()
}

export type CredentialBackedAdapterProviderOptions =
  Omit<ConnectorAdapterProviderOptions, 'resolveDataSource' | 'onCredentialsRotated'>
  & ConnectionCredentialResolverOptions
  & {
    /** Fired after the provider re-persists rotated credentials to the
     *  secret + connection stores. Receives the hub-shaped event including
     *  the resolved secretRef so the host can drive external re-encryption
     *  or telemetry. */
    onCredentialsRotated?: (event: IntegrationCredentialsRotatedEvent) => Promise<void> | void
  }

export function createCredentialBackedAdapterProvider(options: CredentialBackedAdapterProviderOptions): IntegrationProvider {
  const now = options.now ?? (() => new Date())
  return createConnectorAdapterProvider({
    ...options,
    resolveDataSource: createConnectionCredentialResolver(options),
    onCredentialsRotated: async ({ connection, credentials }) => {
      const persistence = connection.secretRef
        ? acquireCredentialPersistence(
            options.secrets,
            connection.connectorId,
            connection.secretRef,
          )
        : undefined
      try {
        await assertCredentialRefreshActive(connection, options, now, persistence)
        if (connection.secretRef) {
          await options.secrets.put(connection.secretRef, credentials)
        }
        await assertCredentialRefreshActive(connection, options, now, persistence)
        if (options.connections) {
          await options.connections.put({
            ...connection,
            status: 'active',
            updatedAt: now().toISOString(),
            expiresAt: credentials.kind === 'oauth2' && credentials.expiresAt
              ? new Date(credentials.expiresAt).toISOString()
              : connection.expiresAt,
          })
          await assertCredentialRefreshActive(connection, options, now, persistence)
        }
        await options.onCredentialsRotated?.({ connection, secretRef: connection.secretRef, credentials })
        await assertCredentialRefreshActive(connection, options, now, persistence)
      } finally {
        if (persistence && connection.secretRef) {
          releaseCredentialPersistence(
            options.secrets,
            connection.connectorId,
            connection.secretRef,
            persistence,
          )
        }
      }
    },
  })
}

function acquireCredentialPersistence(
  secrets: IntegrationSecretStore,
  connectorId: string,
  secretRef: SecretRef,
): CredentialPersistenceLease {
  let persistences = credentialPersistences.get(secrets)
  if (!persistences) {
    persistences = new Map()
    credentialPersistences.set(secrets, persistences)
  }
  const key = credentialRefreshKey(connectorId, secretRef)
  let leases = persistences.get(key)
  if (!leases) {
    leases = new Set()
    persistences.set(key, leases)
  }
  const lease = {
    cancelled: credentialRevocations.get(secrets)?.has(key) === true,
  }
  leases.add(lease)
  return lease
}

function releaseCredentialPersistence(
  secrets: IntegrationSecretStore,
  connectorId: string,
  secretRef: SecretRef,
  lease: CredentialPersistenceLease,
): void {
  const persistences = credentialPersistences.get(secrets)
  if (!persistences) return
  const key = credentialRefreshKey(connectorId, secretRef)
  const leases = persistences.get(key)
  leases?.delete(lease)
  if (leases?.size === 0) persistences.delete(key)
  if (persistences.size === 0) credentialPersistences.delete(secrets)
}

export async function revokeConnection(input: {
  connection: IntegrationConnection
  connections?: IntegrationConnectionStore
  secrets?: IntegrationSecretStore
  now?: () => Date
}): Promise<IntegrationConnection> {
  const finishRevocation = input.connection.secretRef && input.secrets
    ? beginCredentialRevocation(
        input.secrets,
        input.connection.connectorId,
        input.connection.secretRef,
      )
    : undefined
  try {
    if (input.connection.secretRef) await input.secrets?.delete?.(input.connection.secretRef)
    const revoked: IntegrationConnection = {
      ...input.connection,
      status: 'revoked',
      updatedAt: (input.now?.() ?? new Date()).toISOString(),
    }
    await input.connections?.put(revoked)
    return revoked
  } finally {
    finishRevocation?.()
  }
}

function beginCredentialRevocation(
  secrets: IntegrationSecretStore,
  connectorId: string,
  secretRef: SecretRef,
): () => void {
  const key = credentialRefreshKey(connectorId, secretRef)
  let revocations = credentialRevocations.get(secrets)
  if (!revocations) {
    revocations = new Map()
    credentialRevocations.set(secrets, revocations)
  }
  revocations.set(key, (revocations.get(key) ?? 0) + 1)
  const flight = credentialRefreshes.get(secrets)?.get(key)
  if (flight) flight.cancelled = true
  for (const persistence of credentialPersistences.get(secrets)?.get(key) ?? []) {
    persistence.cancelled = true
  }

  return () => {
    const remaining = (revocations?.get(key) ?? 1) - 1
    if (remaining > 0) revocations?.set(key, remaining)
    else revocations?.delete(key)
    if (revocations?.size === 0) credentialRevocations.delete(secrets)
  }
}

function isExpiredOauth(credentials: ConnectorCredentials, now: () => Date): boolean {
  return credentials.kind === 'oauth2'
    && typeof credentials.expiresAt === 'number'
    && credentials.expiresAt <= now().getTime()
    && Boolean(credentials.refreshToken)
}

function secretKey(ref: SecretRef): string {
  return `${ref.provider}:${ref.id}`
}

function credentialRefreshKey(connectorId: string, ref: SecretRef): string {
  return JSON.stringify([connectorId, ref.provider, ref.id])
}
