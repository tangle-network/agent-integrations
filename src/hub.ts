import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  composeIntegrationRegistry,
  type ComposeIntegrationRegistryOptions,
  type IntegrationRegistry,
} from './registry-core.js'
import {
  InMemoryIntegrationOAuthStateStore,
  InMemoryIntegrationSecretStore,
  type IntegrationOAuthState,
} from './credentials.js'
import { IntegrationError } from './core-error.js'
import type {
  CompleteAuthRequest,
  IntegrationActionGuard,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationActor,
  IntegrationCapability,
  IntegrationConnection,
  IntegrationConnectionStore,
  IntegrationConnector,
  IntegrationHubOptions,
  IntegrationPolicyEngine,
  IntegrationProvider,
  IntegrationTriggerEvent,
  IntegrationTriggerSubscription,
  InvokeWithCapabilityRequest,
  IssueCapabilityRequest,
  IssuedIntegrationCapability,
  StartAuthRequest,
  StartAuthResult,
} from './core-types.js'

export class IntegrationHub {
  private readonly providers = new Map<string, IntegrationProvider>()
  private readonly store: IntegrationConnectionStore
  private readonly capabilitySecret: string
  private readonly guard: IntegrationActionGuard | undefined
  private readonly policy: IntegrationPolicyEngine | undefined
  /** Host-injected (or in-memory default) secret store. The hub re-persists
   *  rotated credentials here when a connection carries a secretRef. */
  readonly secretStore: IntegrationHubOptions['secretStore']
  private readonly oauthStateStore: NonNullable<IntegrationHubOptions['oauthStateStore']>
  private readonly oauthStateTtlMs: number
  private readonly credentialsRotated: IntegrationHubOptions['credentialsRotated']
  private readonly now: () => Date

  constructor(options: IntegrationHubOptions) {
    if (!options.capabilitySecret) {
      throw new IntegrationError('capabilitySecret is required.', 'capability_invalid')
    }
    for (const provider of options.providers) this.providers.set(provider.id, provider)
    this.store = options.store
    this.capabilitySecret = options.capabilitySecret
    this.guard = options.guard
    this.policy = options.policy
    this.secretStore = options.secretStore ?? new InMemoryIntegrationSecretStore()
    this.oauthStateStore = options.oauthStateStore ?? new InMemoryIntegrationOAuthStateStore()
    this.oauthStateTtlMs = options.oauthStateTtlMs ?? 10 * 60 * 1000
    this.credentialsRotated = options.credentialsRotated
    this.now = options.now ?? (() => new Date())
  }

  async listConnectors(): Promise<IntegrationConnector[]> {
    const catalogs = await Promise.all([...this.providers.values()].map((provider) => provider.listConnectors()))
    return catalogs.flat()
  }

  async listRegistry(options: ComposeIntegrationRegistryOptions = {}): Promise<IntegrationRegistry> {
    const sources = await Promise.all([...this.providers.values()].map(async (provider) => ({
      id: provider.id,
      connectors: await provider.listConnectors(),
    })))
    return composeIntegrationRegistry(sources, options)
  }

  async startAuth(providerId: string, request: StartAuthRequest): Promise<StartAuthResult> {
    const provider = this.requireProvider(providerId)
    if (!provider.startAuth) throw new IntegrationError(`Provider ${providerId} does not support auth start.`, 'auth_not_supported')
    const connector = await this.requireConnector(provider, request.connectorId)
    const pkce = connectorOAuthPkceMode(connector)
    const pkcePair = pkce === 'unsupported' ? undefined : createPkcePair()
    const result = await provider.startAuth({
      ...request,
      codeChallenge: pkcePair?.challenge,
    })
    const record: IntegrationOAuthState = {
      state: result.state,
      providerId,
      connectorId: request.connectorId,
      owner: request.owner,
      requestedScopes: request.requestedScopes,
      redirectUri: request.redirectUri,
      codeVerifier: pkcePair?.verifier,
      expiresAt: this.now().getTime() + this.oauthStateTtlMs,
      metadata: request.metadata,
    }
    await this.oauthStateStore.put(record)
    return result
  }

  async completeAuth(providerId: string, request: CompleteAuthRequest): Promise<IntegrationConnection> {
    const provider = this.requireProvider(providerId)
    if (!provider.completeAuth) throw new IntegrationError(`Provider ${providerId} does not support auth completion.`, 'auth_not_supported')
    const outcome = await this.oauthStateStore.consume(request.state)
    if (!outcome.ok) {
      throw new IntegrationError(`Integration OAuth state ${outcome.reason}: possible CSRF, replay, or stale flow.`, 'capability_invalid')
    }
    if (outcome.state.providerId !== providerId || outcome.state.connectorId !== request.connectorId) {
      throw new IntegrationError('Integration OAuth state does not match completion request.', 'capability_invalid')
    }
    if (outcome.state.redirectUri !== request.redirectUri) {
      throw new IntegrationError('Integration OAuth redirect URI does not match the start request.', 'capability_invalid')
    }
    const pinnedMetadata = request.metadata || outcome.state.metadata
      ? { ...request.metadata, ...outcome.state.metadata }
      : undefined
    const connection = await provider.completeAuth({
      ...request,
      connectorId: outcome.state.connectorId,
      owner: outcome.state.owner,
      state: outcome.state.state,
      redirectUri: outcome.state.redirectUri,
      codeVerifier: outcome.state.codeVerifier,
      metadata: pinnedMetadata,
    })
    await this.store.put(connection)
    return connection
  }

  async upsertConnection(connection: IntegrationConnection): Promise<IntegrationConnection> {
    await this.store.put(connection)
    return connection
  }

  async listConnections(owner: IntegrationActor): Promise<IntegrationConnection[]> {
    return this.store.listByOwner(owner)
  }

  async getConnection(connectionId: string): Promise<IntegrationConnection | undefined> {
    return this.store.get(connectionId)
  }

  async issueCapability(request: IssueCapabilityRequest): Promise<IssuedIntegrationCapability> {
    const connection = await this.requireConnection(request.connectionId)
    this.assertConnectionActive(connection)
    assertScopes(connection, request.scopes)
    const now = this.now()
    const capability: IntegrationCapability = {
      id: `cap_${randomUUID()}`,
      subject: request.subject,
      connectionId: request.connectionId,
      scopes: unique(request.scopes),
      allowedActions: unique(request.allowedActions),
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + request.ttlMs).toISOString(),
      metadata: request.metadata,
    }
    return { capability, token: signCapability(capability, this.capabilitySecret) }
  }

  verifyCapability(token: string): IntegrationCapability {
    const capability = verifyCapabilityToken(token, this.capabilitySecret)
    if (Date.parse(capability.expiresAt) <= this.now().getTime()) {
      throw new IntegrationError('Integration capability expired.', 'capability_expired')
    }
    return capability
  }

  async invokeWithCapability(token: string, request: InvokeWithCapabilityRequest): Promise<IntegrationActionResult> {
    const capability = this.verifyCapability(token)
    if (!capability.allowedActions.includes(request.action)) {
      throw new IntegrationError(`Capability does not allow action ${request.action}.`, 'action_denied')
    }
    const connection = await this.requireConnection(capability.connectionId)
    this.assertConnectionActive(connection)
    const provider = this.requireProvider(connection.providerId)
    const connector = await this.requireConnector(provider, connection.connectorId)
    const action = connector.actions.find((candidate) => candidate.id === request.action)
    if (!action) throw new IntegrationError(`Action ${request.action} is not defined by connector ${connector.id}.`, 'action_not_found')
    assertScopes(connection, action.requiredScopes)
    assertScopes({ ...connection, grantedScopes: capability.scopes }, action.requiredScopes)
    const fullRequest: IntegrationActionRequest = { ...request, connectionId: connection.id }
    const proceed = async () => {
      if (!this.policy) return provider.invokeAction(connection, fullRequest)
      const decision = await this.policy.decide({
        connection,
        request: fullRequest,
        action,
        subject: capability.subject,
      })
      if (decision.decision === 'deny') {
        throw new IntegrationError(decision.reason, 'policy_denied')
      }
      if (decision.decision === 'require_approval') {
        return {
          ok: false,
          action: request.action,
          output: { approvalRequired: true, approval: decision.approval },
          metadata: { policyDecision: decision.decision, reason: decision.reason, ...decision.metadata },
        }
      }
      return provider.invokeAction(connection, fullRequest)
    }
    if (this.guard) {
      return this.guard.invokeAction({ connection, request: fullRequest, action }, proceed)
    }
    return proceed()
  }

  async subscribeTrigger(connectionId: string, trigger: string, targetUrl?: string): Promise<IntegrationTriggerSubscription> {
    const connection = await this.requireConnection(connectionId)
    this.assertConnectionActive(connection)
    const provider = this.requireProvider(connection.providerId)
    const connector = await this.requireConnector(provider, connection.connectorId)
    const spec = connector.triggers?.find((candidate) => candidate.id === trigger)
    if (!spec) throw new IntegrationError(`Trigger ${trigger} is not defined by connector ${connector.id}.`, 'trigger_not_found')
    assertScopes(connection, spec.requiredScopes)
    if (!provider.subscribeTrigger) {
      throw new IntegrationError(`Provider ${provider.id} does not support triggers.`, 'auth_not_supported')
    }
    return provider.subscribeTrigger(connection, trigger, targetUrl)
  }

  private requireProvider(providerId: string): IntegrationProvider {
    const provider = this.providers.get(providerId)
    if (!provider) throw new IntegrationError(`Provider ${providerId} not found.`, 'provider_not_found')
    return provider
  }

  private async requireConnector(provider: IntegrationProvider, connectorId: string): Promise<IntegrationConnector> {
    const connector = (await provider.listConnectors()).find((candidate) => candidate.id === connectorId)
    if (!connector) throw new IntegrationError(`Connector ${connectorId} not found.`, 'connector_not_found')
    return connector
  }

  private async requireConnection(connectionId: string): Promise<IntegrationConnection> {
    const connection = await this.store.get(connectionId)
    if (!connection) throw new IntegrationError(`Connection ${connectionId} not found.`, 'connection_not_found')
    return connection
  }

  private assertConnectionActive(connection: IntegrationConnection): void {
    if (connection.status !== 'active') {
      throw new IntegrationError(`Connection ${connection.id} is ${connection.status}.`, 'connection_not_active')
    }
    if (connection.expiresAt && Date.parse(connection.expiresAt) <= this.now().getTime()) {
      throw new IntegrationError(`Connection ${connection.id} is expired.`, 'connection_not_active')
    }
  }
}


export function signCapability(capability: IntegrationCapability, secret: string): string {
  const payload = base64UrlEncode(JSON.stringify(capability))
  const signature = hmac(payload, secret)
  return `${payload}.${signature}`
}

export function verifyCapabilityToken(token: string, secret: string): IntegrationCapability {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) throw new IntegrationError('Malformed integration capability.', 'capability_invalid')
  const expected = hmac(payload, secret)
  if (!constantTimeEqual(signature, expected)) throw new IntegrationError('Invalid integration capability signature.', 'capability_invalid')
  let parsed: IntegrationCapability
  try {
    parsed = JSON.parse(base64UrlDecode(payload)) as IntegrationCapability
  } catch {
    throw new IntegrationError('Invalid integration capability payload.', 'capability_invalid')
  }
  if (!parsed.id || !parsed.connectionId || !Array.isArray(parsed.scopes) || !Array.isArray(parsed.allowedActions)) {
    throw new IntegrationError('Invalid integration capability payload.', 'capability_invalid')
  }
  return parsed
}


function assertScopes(connection: Pick<IntegrationConnection, 'grantedScopes'>, requiredScopes: string[]): void {
  const missing = requiredScopes.filter((scope) => !connection.grantedScopes.includes(scope))
  if (missing.length > 0) throw new IntegrationError(`Missing integration scopes: ${missing.join(', ')}`, 'scope_denied')
}


type IntegrationOAuthPkceMode = 'required' | 'supported' | 'unsupported'

function connectorOAuthPkceMode(connector: IntegrationConnector): IntegrationOAuthPkceMode {
  const value = connector.metadata?.oauthPkce
  if (value === undefined) return 'required'
  if (value === 'required' || value === 'supported' || value === 'unsupported') return value
  throw new IntegrationError(
    `Connector ${connector.id} declares an invalid OAuth PKCE posture.`,
    'config_missing',
  )
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

