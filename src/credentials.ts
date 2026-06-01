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
  const current = await options.secrets.get(input.secretRef)
  if (!current) throw new Error(`Secret ${input.secretRef.provider}/${input.secretRef.id} not found.`)
  if (!isExpiredOauth(current, options.now ?? (() => new Date()))) return current

  const adapter = options.adapters?.find((candidate) => candidate.manifest.kind === input.connectorId)
  if (!adapter?.refreshToken) return current
  try {
    const refreshed = await adapter.refreshToken(current)
    await options.secrets.put(input.secretRef, refreshed)
    if (options.connections) {
      await options.connections.put({
        ...input,
        status: 'active',
        updatedAt: (options.now?.() ?? new Date()).toISOString(),
        expiresAt: refreshed.kind === 'oauth2' && refreshed.expiresAt ? new Date(refreshed.expiresAt).toISOString() : input.expiresAt,
      })
    }
    return refreshed
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Credential refresh failed.')
    await options.markConnectionError?.(input, err)
    if (options.connections) {
      await options.connections.put({
        ...input,
        status: 'expired',
        updatedAt: (options.now?.() ?? new Date()).toISOString(),
      })
    }
    throw err
  }
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
      if (connection.secretRef) {
        await options.secrets.put(connection.secretRef, credentials)
      }
      if (options.connections) {
        await options.connections.put({
          ...connection,
          status: 'active',
          updatedAt: now().toISOString(),
          expiresAt: credentials.kind === 'oauth2' && credentials.expiresAt
            ? new Date(credentials.expiresAt).toISOString()
            : connection.expiresAt,
        })
      }
      await options.onCredentialsRotated?.({ connection, secretRef: connection.secretRef, credentials })
    },
  })
}

export async function revokeConnection(input: {
  connection: IntegrationConnection
  connections?: IntegrationConnectionStore
  secrets?: IntegrationSecretStore
  now?: () => Date
}): Promise<IntegrationConnection> {
  if (input.connection.secretRef) await input.secrets?.delete?.(input.connection.secretRef)
  const revoked: IntegrationConnection = {
    ...input.connection,
    status: 'revoked',
    updatedAt: (input.now?.() ?? new Date()).toISOString(),
  }
  await input.connections?.put(revoked)
  return revoked
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
