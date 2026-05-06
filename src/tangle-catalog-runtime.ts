import {
  TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER,
  verifyTangleCatalogRuntimeSignature,
  type TangleCatalogRuntimeRequest,
} from './activepieces-runtime.js'
import { listActivepiecesCatalogEntries } from './activepieces-catalog.js'
import { buildTangleIntegrationCatalogConnectors } from './tangle-catalog.js'
import type {
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
  IntegrationConnectorAction,
} from './index.js'

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
  resolveAuth?: (connection: IntegrationConnection) => Promise<unknown> | unknown
  beforeRun?: (invocation: TangleCatalogRuntimeInvocation) => Promise<void> | void
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

    const loaded = await loadRuntimeModule(packageName, options.moduleLoader, moduleCache)
    if (!loaded.ok) {
      return runtimeFailure(invocation.action.id, 'runtime_not_installed', loaded.message)
    }

    const piece = findPieceExport(loaded.module, invocation.connector.id)
    if (!piece) {
      return runtimeFailure(invocation.action.id, 'runtime_invalid', `Runtime package ${packageName} does not export a recognizable piece for ${invocation.connector.id}.`)
    }

    const action = findRuntimeAction(piece, invocation, options.actionAliases)
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

function findPieceExport(moduleValue: unknown, connectorId: string): { actions?: unknown[] } | undefined {
  const mod = moduleValue && typeof moduleValue === 'object' ? moduleValue as Record<string, unknown> : {}
  const values = [
    mod.default,
    mod[camel(connectorId)],
    mod[connectorId],
    ...Object.values(mod),
  ]
  return values.find((value): value is { actions?: unknown[] } => (
    Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as { actions?: unknown[] }).actions)
  ))
}

function findRuntimeAction(
  piece: { actions?: unknown[] },
  invocation: TangleCatalogRuntimeInvocation,
  aliases: TangleCatalogInstalledPackageExecutorOptions['actionAliases'] = {},
): TangleCatalogRuntimeModuleAction | undefined {
  const actions = (piece.actions ?? [])
    .filter((action): action is TangleCatalogRuntimeModuleAction => Boolean(action) && typeof action === 'object')
  const explicit = aliases[invocation.connector.id]?.[invocation.action.id]
  const candidates = new Set([
    invocation.action.id,
    invocation.action.title,
    invocation.request.piece.upstreamActionName,
    explicit,
  ].filter((value): value is string => Boolean(value)))

  for (const action of actions) {
    const names = [action.name, action.displayName].filter((value): value is string => Boolean(value))
    if (names.some((name) => candidates.has(name))) return action
    if (names.some((name) => [...candidates].some((candidate) => comparable(name) === comparable(candidate)))) return action
  }
  return undefined
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
