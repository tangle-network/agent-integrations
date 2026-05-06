import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  ActivepiecesExecutorInvocation,
  ActivepiecesExecutorProviderOptions,
} from './activepieces-provider.js'
import type {
  IntegrationActionResult,
  IntegrationConnection,
  IntegrationConnector,
} from './index.js'

export const ACTIVEPIECES_RUNTIME_SIGNATURE_HEADER = 'x-tangle-activepieces-signature'
export const TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER = 'x-tangle-catalog-signature'

export interface ActivepiecesRuntimeRequest {
  version: 1
  requestId: string
  providerId: string
  connection: IntegrationConnection
  connector: Pick<IntegrationConnector, 'id' | 'title' | 'auth' | 'scopes' | 'metadata'>
  piece: ActivepiecesExecutorInvocation['piece']
  action: {
    id: string
    input: unknown
    idempotencyKey?: string
    dryRun?: boolean
    metadata?: Record<string, unknown>
  }
}

export interface ActivepiecesHttpExecutorOptions {
  endpoint: string
  path?: string
  signatureHeader?: string
  secret?: string
  fetchImpl?: typeof fetch
  headers?: Record<string, string>
  timeoutMs?: number
  requestId?: () => string
}

export function createActivepiecesHttpExecutor(
  options: ActivepiecesHttpExecutorOptions,
): ActivepiecesExecutorProviderOptions['executeAction'] {
  const endpoint = options.endpoint.replace(/\/$/, '')
  const path = options.path ?? '/v1/activepieces/actions/invoke'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const signatureHeader = options.signatureHeader ?? ACTIVEPIECES_RUNTIME_SIGNATURE_HEADER
  const fetchImpl = options.fetchImpl ?? fetch
  const requestId = options.requestId ?? (() => `apexec_${randomUUID()}`)
  return async (invocation) => {
    const body = buildActivepiecesRuntimeRequest(invocation, requestId())
    const serialized = JSON.stringify(body)
    const response = await fetchImpl(`${endpoint}${normalizedPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers,
        ...(options.secret
          ? { [signatureHeader]: signActivepiecesRuntimeRequest(serialized, options.secret) }
          : {}),
      },
      body: serialized,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    })
    const parsed = await response.json().catch(() => undefined) as IntegrationActionResult | undefined
    if (!response.ok) {
      return parsed ?? {
        ok: false,
        action: invocation.request.action,
        output: { message: `Activepieces runtime returned HTTP ${response.status}.` },
      }
    }
    return parsed ?? {
      ok: false,
      action: invocation.request.action,
      output: { message: 'Activepieces runtime returned an empty response.' },
    }
  }
}

export function buildActivepiecesRuntimeRequest(
  invocation: ActivepiecesExecutorInvocation,
  requestId = `apexec_${randomUUID()}`,
): ActivepiecesRuntimeRequest {
  return {
    version: 1,
    requestId,
    providerId: invocation.connection.providerId,
    connection: invocation.connection,
    connector: {
      id: invocation.connector.id,
      title: invocation.connector.title,
      auth: invocation.connector.auth,
      scopes: invocation.connector.scopes,
      metadata: invocation.connector.metadata,
    },
    piece: invocation.piece,
    action: {
      id: invocation.request.action,
      input: invocation.request.input,
      idempotencyKey: invocation.request.idempotencyKey,
      dryRun: invocation.request.dryRun,
      metadata: invocation.request.metadata,
    },
  }
}

export function signActivepiecesRuntimeRequest(serializedBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(serializedBody).digest('hex')}`
}

export function verifyActivepiecesRuntimeSignature(
  serializedBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature) return false
  const expected = signActivepiecesRuntimeRequest(serializedBody, secret)
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export interface TangleCatalogRuntimeRequest {
  version: 1
  requestId: string
  providerId: string
  connection: IntegrationConnection
  connector: Pick<IntegrationConnector, 'id' | 'title' | 'auth' | 'scopes' | 'metadata'>
  piece: TangleCatalogHttpExecutorInvocation['piece']
  action: ActivepiecesRuntimeRequest['action']
}

export type TangleCatalogHttpExecutorOptions = ActivepiecesHttpExecutorOptions
export interface TangleCatalogHttpExecutorInvocation extends Omit<ActivepiecesExecutorInvocation, 'catalogEntry' | 'piece'> {
  catalogEntry: unknown
  piece: {
    id: string
    packageName?: string
    version?: string
    actionId: string
    upstreamActionName?: string
  }
}

export function createTangleCatalogHttpExecutor(
  options: TangleCatalogHttpExecutorOptions,
): (invocation: TangleCatalogHttpExecutorInvocation) => ReturnType<ActivepiecesExecutorProviderOptions['executeAction']> {
  const endpoint = options.endpoint.replace(/\/$/, '')
  const path = options.path ?? '/v1/integration-catalog/actions/invoke'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const signatureHeader = options.signatureHeader ?? TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER
  const fetchImpl = options.fetchImpl ?? fetch
  const requestId = options.requestId ?? (() => `tcat_${randomUUID()}`)
  return async (invocation) => {
    const body = buildTangleCatalogRuntimeRequest(invocation, requestId())
    const serialized = JSON.stringify(body)
    const response = await fetchImpl(`${endpoint}${normalizedPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...options.headers,
        ...(options.secret
          ? { [signatureHeader]: signTangleCatalogRuntimeRequest(serialized, options.secret) }
          : {}),
      },
      body: serialized,
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    })
    const parsed = await response.json().catch(() => undefined) as IntegrationActionResult | undefined
    if (!response.ok) {
      return parsed ?? {
        ok: false,
        action: invocation.request.action,
        output: { message: `Tangle catalog runtime returned HTTP ${response.status}.` },
      }
    }
    return parsed ?? {
      ok: false,
      action: invocation.request.action,
      output: { message: 'Tangle catalog runtime returned an empty response.' },
    }
  }
}

export function buildTangleCatalogRuntimeRequest(
  invocation: TangleCatalogHttpExecutorInvocation,
  requestId = `tcat_${randomUUID()}`,
): TangleCatalogRuntimeRequest {
  return {
    version: 1,
    requestId,
    providerId: invocation.connection.providerId,
    connection: invocation.connection,
    connector: {
      id: invocation.connector.id,
      title: invocation.connector.title,
      auth: invocation.connector.auth,
      scopes: invocation.connector.scopes,
      metadata: invocation.connector.metadata,
    },
    piece: invocation.piece,
    action: {
      id: invocation.request.action,
      input: invocation.request.input,
      idempotencyKey: invocation.request.idempotencyKey,
      dryRun: invocation.request.dryRun,
      metadata: invocation.request.metadata,
    },
  }
}

export const signTangleCatalogRuntimeRequest = signActivepiecesRuntimeRequest
export const verifyTangleCatalogRuntimeSignature = verifyActivepiecesRuntimeSignature
