import {
  TANGLE_CATALOG_RUNTIME_SIGNATURE_HEADER,
  verifyTangleCatalogRuntimeSignature,
  type TangleCatalogRuntimeRequest,
} from './activepieces-runtime.js'
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

function serializeBody(body: TangleCatalogRuntimeHttpRequest['body']): string {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return JSON.stringify(body)
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
