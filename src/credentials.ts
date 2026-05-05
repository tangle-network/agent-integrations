import { createConnectorAdapterProvider, type ConnectorAdapterProviderOptions } from './adapter-provider.js'
import type {
  ConnectorAdapter,
  ConnectorCredentials,
  ResolvedDataSource,
} from './connectors/types.js'
import type {
  IntegrationConnection,
  IntegrationConnectionStore,
  IntegrationProvider,
  SecretRef,
} from './index.js'

export interface IntegrationSecretStore {
  get(ref: SecretRef): Promise<ConnectorCredentials | undefined> | ConnectorCredentials | undefined
  put(ref: SecretRef, credentials: ConnectorCredentials): Promise<void> | void
  delete?(ref: SecretRef): Promise<void> | void
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

export function createCredentialBackedAdapterProvider(options: Omit<ConnectorAdapterProviderOptions, 'resolveDataSource'> & ConnectionCredentialResolverOptions): IntegrationProvider {
  return createConnectorAdapterProvider({
    ...options,
    resolveDataSource: createConnectionCredentialResolver(options),
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
