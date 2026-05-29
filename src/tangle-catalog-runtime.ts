import {
  TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER,
  signTangleCatalogRuntimeRequest,
  verifyTangleCatalogRuntimeSignature,
  type TangleCatalogRuntimeRequest,
} from './activepieces-runtime.js'
import { randomUUID } from 'node:crypto'
import { listActivepiecesCatalogEntries } from './activepieces-catalog.js'
import { buildTangleIntegrationCatalogConnectors } from './tangle-catalog.js'
import type {
  ConnectorCredentials,
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationConnectorAction,
  IntegrationSecretStore,
} from './index.js'

export {
  TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER,
  signTangleCatalogRuntimeRequest,
  verifyTangleCatalogRuntimeSignature,
}

export interface TangleCatalogRuntimeInvocation {
  request: TangleCatalogRuntimeRequest
  connection: IntegrationConnection
  connector: IntegrationConnector
  action: IntegrationConnectorAction
}

export interface TangleCatalogRuntimeHandlerOptions {
  secret?: string
  requireSignature?: boolean
  signatureHeader?: string
  connectors?: IntegrationConnector[]
  maxBodyBytes?: number
  executeAction: (invocation: TangleCatalogRuntimeInvocation) => Promise<IntegrationActionResult> | IntegrationActionResult
}

export interface TangleCatalogInstalledPackageExecutorOptions {
  moduleLoader?: (packageName: string) => Promise<unknown> | unknown
  actionAliases?: Record<string, Record<string, string>>
  allowFuzzyActionMatch?: boolean
  resolveAuth?: (connection: IntegrationConnection) => Promise<unknown> | unknown
  beforeRun?: (invocation: TangleCatalogRuntimeInvocation) => Promise<void> | void
}

export interface TangleCatalogAuthResolverOptions {
  secrets: IntegrationSecretStore
  mapCredentials?: (input: {
    connection: IntegrationConnection
    credentials: ConnectorCredentials
    connectorId: string
  }) => unknown
}

export interface TangleCatalogHttpAuthResolverOptions {
  endpoint: string
  secret: string
  path?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  requestId?: () => string
}

export interface TangleCatalogHttpAuthResolverRequest {
  version: 1
  requestId: string
  providerId: string
  connectorId: string
  connectionId: string
  secretRef?: IntegrationConnection['secretRef']
}

export interface TangleCatalogRuntimeModuleAction {
  name?: string
  displayName?: string
  run?: (context: {
    auth: unknown
    propsValue: unknown
    input: unknown
    connection: IntegrationConnection
    request: TangleCatalogRuntimeRequest
  }) => Promise<unknown> | unknown
}

export interface TangleCatalogRuntimeHttpRequest {
  body: string | Uint8Array | TangleCatalogRuntimeRequest
  headers?: Headers | Record<string, string | string[] | undefined>
}

export interface TangleCatalogRuntimeHttpResponse {
  status: number
  headers: Record<string, string>
  body: IntegrationActionResult | {
    ok: false
    action: string
    output: {
      code: string
      message: string
    }
  }
}

export interface TangleCatalogRuntimePackageCoverageRow {
  connectorId: string
  packageName: string
  packageInstalled: boolean
  packageLoads: boolean
  pieceExportFound: boolean
  actionMappingsVerified: number
  actionMappingsTotal: number
  triggerMappingsFound: number
  triggerMappingsTotal: number
  triggerHostingSupported: boolean
  error?: string
}

export interface TangleCatalogRuntimePackageCoverageOptions {
  connectorIds?: string[]
  moduleLoader?: (packageName: string) => Promise<unknown> | unknown
}

export function createTangleCatalogRuntimeHandler(options: TangleCatalogRuntimeHandlerOptions) {
  const connectors = options.connectors ?? buildTangleIntegrationCatalogConnectors({
    includeCatalogActions: true,
    executable: true,
  })
  const byConnector = new Map(connectors.map((connector) => [connector.id, connector]))
  const requireSignature = options.requireSignature ?? Boolean(options.secret)
  const signatureHeader = options.signatureHeader ?? TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000

  return async function handleTangleCatalogRuntimeRequest(
    input: TangleCatalogRuntimeHttpRequest,
  ): Promise<TangleCatalogRuntimeHttpResponse> {
    const serialized = serializeBody(input.body)
    if (Buffer.byteLength(serialized, 'utf8') > maxBodyBytes) {
      return errorResponse(413, 'unknown', 'payload_too_large', 'Tangle catalog runtime request is too large.')
    }

    if (requireSignature) {
      if (!options.secret) {
        return errorResponse(500, 'unknown', 'runtime_misconfigured', 'Tangle catalog runtime secret is not configured.')
      }
      const signature = readHeader(input.headers, signatureHeader)
      if (!verifyTangleCatalogRuntimeSignature(serialized, signature, options.secret)) {
        return errorResponse(401, 'unknown', 'signature_invalid', 'Tangle catalog runtime signature is invalid.')
      }
    }

    const parsed = parseRuntimeRequest(serialized)
    if (!parsed.ok) return parsed.response

    const request = parsed.request
    if (request.providerId !== request.connection.providerId) {
      return errorResponse(400, request.action.id, 'provider_mismatch', 'Request providerId does not match connection providerId.')
    }
    const connector = byConnector.get(request.connector.id)
    if (!connector) {
      return errorResponse(404, request.action.id, 'connector_not_found', `Connector ${request.connector.id} is not in the Tangle catalog runtime.`)
    }
    if (request.connection.connectorId !== connector.id) {
      return errorResponse(400, request.action.id, 'connector_mismatch', 'Connection connectorId does not match runtime connector.')
    }
    if (request.connection.providerId !== connector.providerId) {
      return errorResponse(400, request.action.id, 'provider_mismatch', 'Connection providerId does not match runtime connector.')
    }
    const action = connector.actions.find((candidate) => candidate.id === request.action.id)
    if (!action) {
      return errorResponse(404, request.action.id, 'action_not_found', `Action ${request.action.id} is not defined by connector ${connector.id}.`)
    }

    const result = await options.executeAction({
      request,
      connection: request.connection,
      connector,
      action,
    })
    return {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
      body: result,
    }
  }
}

export function createTangleCatalogInstalledPackageExecutor(
  options: TangleCatalogInstalledPackageExecutorOptions = {},
): TangleCatalogRuntimeHandlerOptions['executeAction'] {
  const packageByConnector = new Map(
    listActivepiecesCatalogEntries()
      .filter((entry) => entry.npmPackage)
      .map((entry) => [entry.id, entry.npmPackage!]),
  )
  const moduleCache = new Map<string, Promise<unknown>>()

  return async (invocation) => {
    await options.beforeRun?.(invocation)
    const packageName = packageByConnector.get(invocation.connector.id)
    if (!packageName) {
      return runtimeFailure(invocation.action.id, 'runtime_not_available', `No installed runtime package is known for connector ${invocation.connector.id}.`)
    }
    if (invocation.request.piece.packageName && invocation.request.piece.packageName !== packageName) {
      return runtimeFailure(
        invocation.action.id,
        'runtime_package_mismatch',
        `Runtime package ${invocation.request.piece.packageName} does not match catalog package ${packageName}.`,
      )
    }

    const loaded = await loadRuntimeModule(packageName, options.moduleLoader, moduleCache)
    if (!loaded.ok) {
      return runtimeFailure(invocation.action.id, 'runtime_not_installed', loaded.message)
    }

    const piece = findPieceExport(loaded.module, invocation.connector.id)
    if (!piece) {
      return runtimeFailure(invocation.action.id, 'runtime_invalid', `Runtime package ${packageName} does not export a recognizable piece for ${invocation.connector.id}.`)
    }

    const action = findRuntimeAction(piece, invocation, options.actionAliases, options.allowFuzzyActionMatch ?? false)
    if (!action?.run) {
      return runtimeFailure(invocation.action.id, 'action_not_implemented', `Runtime package ${packageName} does not expose executable action ${invocation.action.id}.`)
    }

    try {
      const output = await action.run({
        auth: await options.resolveAuth?.(invocation.connection),
        propsValue: invocation.request.action.input,
        input: invocation.request.action.input,
        connection: invocation.connection,
        request: invocation.request,
      })
      return {
        ok: true,
        action: invocation.action.id,
        output,
      }
    } catch (error) {
      return runtimeFailure(
        invocation.action.id,
        'runtime_action_failed',
        error instanceof Error ? error.message : 'Runtime action failed.',
      )
    }
  }
}

export async function auditTangleCatalogRuntimePackages(
  options: TangleCatalogRuntimePackageCoverageOptions = {},
): Promise<TangleCatalogRuntimePackageCoverageRow[]> {
  const only = options.connectorIds ? new Set(options.connectorIds) : undefined
  const rows: TangleCatalogRuntimePackageCoverageRow[] = []
  const moduleCache = new Map<string, Promise<unknown>>()
  const entries = listActivepiecesCatalogEntries()
    .filter((entry) => entry.npmPackage && (!only || only.has(entry.id)))

  for (const entry of entries) {
    const packageName = entry.npmPackage!
    const base = {
      connectorId: entry.id,
      packageName,
      actionMappingsTotal: entry.actions.length,
      triggerMappingsTotal: entry.triggers.length,
    }
    const loaded = await loadRuntimeModule(packageName, options.moduleLoader, moduleCache)
    if (!loaded.ok) {
      rows.push({
        ...base,
        packageInstalled: false,
        packageLoads: false,
        pieceExportFound: false,
        actionMappingsVerified: 0,
        triggerMappingsFound: 0,
        triggerHostingSupported: false,
        error: loaded.message,
      })
      continue
    }
    const piece = findPieceExport(loaded.module, entry.id)
    const actions = piece?.actions ?? []
    const triggers = piece?.triggers ?? []
    rows.push({
      ...base,
      packageInstalled: true,
      packageLoads: true,
      pieceExportFound: Boolean(piece),
      actionMappingsVerified: entry.actions.filter((action) => hasRuntimeName(actions, [
        action.id,
        action.title,
        action.upstreamName,
      ], entry.id)).length,
      triggerMappingsFound: entry.triggers.filter((trigger) => hasRuntimeName(triggers, [
        trigger.id,
        trigger.title,
        trigger.upstreamName,
      ], entry.id)).length,
      triggerHostingSupported: entry.triggers.length === 0 || triggers.length > 0,
    })
  }

  return rows
}

export function createTangleCatalogCredentialAuthResolver(options: TangleCatalogAuthResolverOptions) {
  return async function resolveTangleCatalogAuth(connection: IntegrationConnection): Promise<unknown> {
    if (!connection.secretRef) return undefined
    const credentials = await options.secrets.get(connection.secretRef)
    if (!credentials) throw new Error(`Secret ${connection.secretRef.provider}/${connection.secretRef.id} not found.`)
    return options.mapCredentials?.({
      connection,
      credentials,
      connectorId: connection.connectorId,
    }) ?? tangleCatalogAuthValue(credentials)
  }
}

export function createTangleCatalogHttpAuthResolver(options: TangleCatalogHttpAuthResolverOptions) {
  const endpoint = options.endpoint.replace(/\/$/, '')
  const path = options.path ?? '/v1/integration-catalog/credentials/resolve'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const fetchImpl = options.fetchImpl ?? fetch
  const requestId = options.requestId ?? (() => `tcat_auth_${randomUUID()}`)

  return async function resolveTangleCatalogHttpAuth(connection: IntegrationConnection): Promise<unknown> {
    const body: TangleCatalogHttpAuthResolverRequest = {
      version: 1,
      requestId: requestId(),
      providerId: connection.providerId,
      connectorId: connection.connectorId,
      connectionId: connection.id,
      secretRef: connection.secretRef,
    }
    const serialized = JSON.stringify(body)
    const response = await fetchImpl(`${endpoint}${normalizedPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers,
        [TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER]: signTangleCatalogRuntimeRequest(serialized, options.secret),
      },
      body: serialized,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    const parsed = await response.json().catch(() => undefined) as {
      auth?: unknown
      credentials?: ConnectorCredentials
      error?: { message?: string }
    } | undefined
    if (!response.ok) {
      throw new Error(parsed?.error?.message ?? `Credential resolver returned HTTP ${response.status}.`)
    }
    if (parsed && 'auth' in parsed) return parsed.auth
    if (parsed?.credentials) return tangleCatalogAuthValue(parsed.credentials)
    return undefined
  }
}

export function tangleCatalogAuthValue(credentials: ConnectorCredentials): unknown {
  if (credentials.kind === 'none') return undefined
  if (credentials.kind === 'api-key') return credentials.apiKey
  if (credentials.kind === 'hmac') return credentials.secret
  if (credentials.kind === 'custom') return credentials.values
  return {
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
    expires_at: credentials.expiresAt,
  }
}


function serializeBody(body: TangleCatalogRuntimeHttpRequest['body']): string {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return JSON.stringify(body)
}

async function loadRuntimeModule(
  packageName: string,
  moduleLoader: TangleCatalogInstalledPackageExecutorOptions['moduleLoader'],
  moduleCache: Map<string, Promise<unknown>>,
): Promise<{ ok: true; module: unknown } | { ok: false; message: string }> {
  try {
    const load = moduleLoader ?? ((name: string) => import(name))
    const promise = moduleCache.get(packageName) ?? Promise.resolve(load(packageName))
    moduleCache.set(packageName, promise)
    return { ok: true, module: await promise }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? `Runtime package ${packageName} could not be loaded: ${error.message}`
        : `Runtime package ${packageName} could not be loaded.`,
    }
  }
}

/** A resolved Activepieces Piece export with its runnable actions/triggers
 *  normalized to arrays. @activepieces/pieces-framework >=0.25 stores actions
 *  in a private `_actions` record and exposes `actions`/`triggers` as instance
 *  methods (not arrays), so a piece is recognized by its export shape rather
 *  than by `Array.isArray(piece.actions)`. */
interface ResolvedPiece {
  actions: TangleCatalogRuntimeModuleAction[]
  triggers: TangleCatalogRuntimeModuleAction[]
}

function findPieceExport(moduleValue: unknown, connectorId: string): ResolvedPiece | undefined {
  const mod = moduleValue && typeof moduleValue === 'object' ? moduleValue as Record<string, unknown> : {}
  const values = [
    mod.default,
    mod[camel(connectorId)],
    mod[connectorId],
    ...Object.values(mod),
  ]
  for (const value of values) {
    const resolved = resolvePiece(value)
    if (resolved) return resolved
  }
  return undefined
}

/** Recognize an Activepieces Piece and read its runnable records. Accepts the
 *  framework's private `_actions`/`_triggers` records, the `actions`/`triggers`
 *  getter or method, and a legacy plain array — in that precedence. */
function resolvePiece(value: unknown): ResolvedPiece | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const candidate = value as Record<string, unknown>
  const ctorName = (candidate.constructor as { name?: string } | undefined)?.name
  const looksLikePiece =
    ctorName === 'Piece' ||
    '_actions' in candidate ||
    '_triggers' in candidate ||
    'actions' in candidate ||
    'triggers' in candidate
  if (!looksLikePiece) return undefined

  const actions = readPieceMembers(candidate, '_actions', 'actions')
  const triggers = readPieceMembers(candidate, '_triggers', 'triggers')
  if (!actions && !triggers) return undefined
  return { actions: actions ?? [], triggers: triggers ?? [] }
}

/** Read a piece member collection from the private record, the public
 *  getter/method, or a plain array. Returns undefined when no recognizable
 *  collection exists (so the caller can reject non-piece values). */
function readPieceMembers(
  piece: Record<string, unknown>,
  privateKey: string,
  publicKey: string,
): TangleCatalogRuntimeModuleAction[] | undefined {
  const raw =
    coerceMemberCollection(piece[privateKey]) ??
    coerceMemberCollection(readPublicMember(piece, publicKey))
  if (!raw) return undefined
  return raw.filter((member): member is TangleCatalogRuntimeModuleAction =>
    Boolean(member) && typeof member === 'object')
}

function readPublicMember(piece: Record<string, unknown>, key: string): unknown {
  const value = piece[key]
  if (typeof value !== 'function') return value
  try {
    return (value as () => unknown).call(piece)
  } catch {
    return undefined
  }
}

function coerceMemberCollection(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return undefined
}

function hasRuntimeName(
  members: TangleCatalogRuntimeModuleAction[],
  candidates: Array<string | undefined>,
  connectorId: string,
): boolean {
  const expected = normalizeNameSet(candidates, connectorId)
  return members.some((member) => {
    const names = normalizeNameSet([member.name, member.displayName], connectorId)
    for (const name of names) if (expected.has(name)) return true
    return false
  })
}

function findRuntimeAction(
  piece: ResolvedPiece,
  invocation: TangleCatalogRuntimeInvocation,
  aliases: TangleCatalogInstalledPackageExecutorOptions['actionAliases'] = {},
  allowFuzzyActionMatch = false,
): TangleCatalogRuntimeModuleAction | undefined {
  const actions = piece.actions
  const explicit = aliases[invocation.connector.id]?.[invocation.action.id]
  if (explicit) {
    const exact = actions.find((action) => action.name === explicit || action.displayName === explicit)
    if (exact) return exact
  }
  const connectorId = invocation.connector.id
  const candidates = normalizeNameSet([
    invocation.action.id,
    invocation.action.title,
    invocation.request.piece.upstreamActionName,
    explicit,
  ], connectorId)

  for (const action of actions) {
    const names = normalizeNameSet([action.name, action.displayName], connectorId)
    for (const name of names) if (candidates.has(name)) return action
  }
  // allowFuzzyActionMatch is retained for API compatibility; the normalized
  // comparison above is already insensitive to snake/camel/dot/space casing
  // and connector-name prefixes, so it subsumes the prior fuzzy pass.
  void allowFuzzyActionMatch
  return undefined
}

/** Build the comparison key set for a set of catalog/package identifiers.
 *  Both sides are reduced to alphanumeric-lowercase, then expanded with
 *  connector-name-prefix-stripped and action/trigger-suffix-stripped variants
 *  so `gmail.send.email` / `gmailSendEmailAction` / `Send Email` / `send_email`
 *  all collapse to a shared `sendemail` key. */
function normalizeNameSet(values: Array<string | undefined>, connectorId: string): Set<string> {
  const out = new Set<string>()
  const conn = comparable(connectorId)
  for (const value of values) {
    if (!value) continue
    for (const variant of nameVariants(comparable(value), conn)) {
      if (variant) out.add(variant)
    }
  }
  return out
}

function nameVariants(cmp: string, conn: string): string[] {
  const base = [cmp, cmp.replace(/(action|trigger)$/, '')]
  const variants: string[] = []
  for (const value of base) {
    variants.push(value)
    if (conn && value.startsWith(conn) && value.length > conn.length) {
      variants.push(value.slice(conn.length))
    }
  }
  return variants
}

function runtimeFailure(action: string, code: string, message: string): IntegrationActionResult {
  return {
    ok: false,
    action,
    output: { code, message },
  }
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function camel(value: string): string {
  return value.replace(/[-_.]+([a-z0-9])/g, (_, char: string) => char.toUpperCase())
}

function parseRuntimeRequest(serialized: string):
  | { ok: true; request: TangleCatalogRuntimeRequest }
  | { ok: false; response: TangleCatalogRuntimeHttpResponse } {
  try {
    const request = JSON.parse(serialized) as Partial<TangleCatalogRuntimeRequest>
    if (request.version !== 1) {
      return { ok: false, response: errorResponse(400, request.action?.id ?? 'unknown', 'version_invalid', 'Unsupported Tangle catalog runtime request version.') }
    }
    if (!request.connection || !request.connector || !request.action?.id) {
      return { ok: false, response: errorResponse(400, request.action?.id ?? 'unknown', 'request_invalid', 'Tangle catalog runtime request is missing required fields.') }
    }
    return { ok: true, request: request as TangleCatalogRuntimeRequest }
  } catch {
    return { ok: false, response: errorResponse(400, 'unknown', 'json_invalid', 'Tangle catalog runtime request body is not valid JSON.') }
  }
}

function readHeader(headers: TangleCatalogRuntimeHttpRequest['headers'], name: string): string | undefined {
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    if (Array.isArray(value)) return value[0]
    return value
  }
  return undefined
}

function errorResponse(
  status: number,
  action: string,
  code: string,
  message: string,
): TangleCatalogRuntimeHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: {
      ok: false,
      action,
      output: { code, message },
    },
  }
}
