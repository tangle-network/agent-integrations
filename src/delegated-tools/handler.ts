/**
 * Transport-agnostic JSON-RPC 2.0 callback handler for the delegated-tool
 * bridge — the endpoint an EXTERNAL stateful agent calls back into mid-session,
 * authorized by the bearer minted via {@link mintDelegatedToolToken}.
 *
 * The product supplies three seams; the handler bakes in no domain assumptions
 * (no voice/phony/calendar specifics):
 *
 *   - `verifyToken(bearer)` → claims | null — recover & validate the lease
 *     (fresh, signed). Usually {@link verifyDelegatedToolToken} bound to a secret.
 *   - `resolveTool(workspaceId, name)` → invocable | null — the product's tool
 *     registry. `null` means "this workspace cannot reach that tool right now".
 *   - `isIntegrationConnected(workspaceId, tool)` → boolean — the live
 *     connectivity gate; a stale token naming a since-disconnected integration
 *     resolves but fails this check.
 *
 * FAIL-CLOSED, in order, for `tools/call`: (1) bearer verifies, (2) tool is in
 * the lease allow-list, (3) tool resolves for the workspace, (4) the backing
 * integration is connected. Any miss returns a JSON-RPC error and the invocable
 * is never touched.
 *
 * `tools/list` is advisory: it returns the intersection of the allow-list with
 * what currently resolves + is connected, omitting (never erroring) the rest.
 */

import type { DelegatedToolClaims } from './token.js'

export interface DelegatedToolDescriptor {
  /** Wire name the external agent calls by. */
  name: string
  description?: string
  /** JSON Schema for the tool arguments. Defaults to `{ type: 'object' }`. */
  inputSchema?: unknown
}

export interface ResolvedDelegatedTool extends DelegatedToolDescriptor {
  /**
   * Invoke the tool with the JSON-RPC `arguments`. Returns the JSON-RPC `result`
   * payload on success. Throw {@link DelegatedToolInvocationError} to surface a
   * structured JSON-RPC error (code + data); any other throw becomes -32000.
   */
  invoke(args: Record<string, unknown>): Promise<unknown>
}

/** Throw from `resolveTool().invoke` to control the JSON-RPC error envelope. */
export class DelegatedToolInvocationError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(message: string, options: { code?: number; data?: unknown } = {}) {
    super(message)
    this.name = 'DelegatedToolInvocationError'
    this.code = options.code ?? -32000
    this.data = options.data
  }
}

export interface DelegatedToolCallSeams {
  /** Recover lease claims from a raw bearer string, or `null` to reject. */
  verifyToken(bearer: string): Promise<DelegatedToolClaims | null> | DelegatedToolClaims | null
  /** The product's tool registry. `null` ⇒ not reachable for this workspace. */
  resolveTool(
    workspaceId: string,
    name: string,
  ): Promise<ResolvedDelegatedTool | null> | ResolvedDelegatedTool | null
  /** Live connectivity gate for the integration backing `tool`. */
  isIntegrationConnected(
    workspaceId: string,
    tool: ResolvedDelegatedTool,
  ): Promise<boolean> | boolean
  /**
   * Optional advertised name/version for the JSON-RPC `initialize` handshake.
   * Defaults to `{ name: 'delegated-tools', version: '1' }`.
   */
  serverInfo?: { name: string; version: string }
}

export interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const PROTOCOL_VERSION = '2024-11-05'

function normalizeId(id: unknown): string | number | null {
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

function rpcResult(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: normalizeId(id), result }
}

function rpcError(id: unknown, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: normalizeId(id),
    error: data === undefined ? { code, message } : { code, message, data },
  }
}

function extractBearer(authorization: string | null | undefined): string | undefined {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
}

/**
 * Handle one JSON-RPC call. Accepts a parsed body + the raw `authorization`
 * header value. Returns the JSON-RPC response object (the transport wrapper —
 * {@link handleDelegatedToolRequest} — turns it into an HTTP `Response`).
 */
export async function handleDelegatedToolCall(
  body: JsonRpcRequest,
  authorization: string | null | undefined,
  seams: DelegatedToolCallSeams,
): Promise<JsonRpcResponse> {
  const id = body.id ?? null
  const method = typeof body.method === 'string' ? body.method : ''

  const bearer = extractBearer(authorization)
  const claims = bearer ? await seams.verifyToken(bearer) : null
  if (!claims) return rpcError(id, -32001, 'Unauthorized')

  if (method === 'initialize') {
    const info = seams.serverInfo ?? { name: 'delegated-tools', version: '1' }
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: info,
    })
  }

  if (method === 'tools/list') {
    const tools: DelegatedToolDescriptor[] = []
    for (const name of claims.allowedTools) {
      const tool = await seams.resolveTool(claims.workspaceId, name)
      if (!tool) continue
      if (!(await seams.isIntegrationConnected(claims.workspaceId, tool))) continue
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object' },
      })
    }
    return rpcResult(id, { tools })
  }

  if (method === 'tools/call') {
    const params = (body.params ?? {}) as { name?: unknown; arguments?: unknown }
    const name = typeof params.name === 'string' ? params.name : ''
    const args =
      params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {}

    if (!name) return rpcError(id, -32602, 'Missing tool name')
    if (!claims.allowedTools.includes(name)) {
      return rpcError(id, -32602, `Tool not delegated to this session: ${name}`)
    }
    const tool = await seams.resolveTool(claims.workspaceId, name)
    if (!tool) return rpcError(id, -32602, `Tool not available for workspace: ${name}`)
    if (!(await seams.isIntegrationConnected(claims.workspaceId, tool))) {
      return rpcError(id, -32602, `Integration not connected for tool: ${name}`)
    }

    try {
      const result = await tool.invoke(args)
      return rpcResult(id, result)
    } catch (err) {
      if (err instanceof DelegatedToolInvocationError) {
        return rpcError(id, err.code, err.message, err.data)
      }
      return rpcError(id, -32000, err instanceof Error ? err.message : 'Tool invocation failed')
    }
  }

  return rpcError(id, -32601, `Method not found: ${method || '(none)'}`)
}

/**
 * HTTP transport wrapper around {@link handleDelegatedToolCall}: parses the
 * request, enforces POST, maps the JSON-RPC response to a `Response`. Unauthorized
 * is the only non-200 status (401) so an unauthenticated probe can't distinguish
 * methods; every authenticated JSON-RPC error rides a 200 per the JSON-RPC contract.
 */
export async function handleDelegatedToolRequest(
  request: Request,
  seams: DelegatedToolCallSeams,
): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  let body: JsonRpcRequest
  try {
    body = (await request.json()) as JsonRpcRequest
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'))
  }

  const response = await handleDelegatedToolCall(body, request.headers.get('authorization'), seams)
  if (response.error?.code === -32001) {
    return Response.json(response, { status: 401 })
  }
  return Response.json(response)
}
