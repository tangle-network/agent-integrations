/**
 * Live MCP connector — attach a remote MCP (Model Context Protocol) server
 * as an {@link IntegrationProvider}, so its tools flow through the same
 * catalog / grants / approvals machinery as every other connector instead of
 * forming a parallel, ungoverned tool path.
 *
 * Transport is Streamable HTTP only (single POST endpoint, JSON or SSE
 * response framing) — this package runs in edge workers, so stdio servers are
 * out of scope; front them with any HTTP-bridging MCP host.
 *
 * Discovery reuses {@link importMcpConnector}: `tools/list` output becomes an
 * `IntegrationConnector` whose per-action risk comes from MCP tool
 * annotations (readOnlyHint / destructiveHint) with a text-heuristic
 * fallback, so non-read MCP tools default to `approvalRequired` — fail-closed
 * against servers that don't annotate.
 *
 * Credentials: the server's auth header is supplied at construction by the
 * product (which owns secret storage) and held in memory only. Connection
 * rows carry no MCP secrets.
 */

import { IntegrationError } from './core-error.js'
import type {
  IntegrationActionResult,
  IntegrationActionRisk,
  IntegrationConnector,
  IntegrationConnectorCategory,
  IntegrationDataClass,
  IntegrationProvider,
} from './core-types.js'
import { createCatalogExecutorProvider } from './catalog-executor.js'
import { importMcpConnector, type McpCatalogTool } from './importers.js'

/** Protocol revision sent on `initialize` and the `MCP-Protocol-Version`
 *  header. Servers negotiate down from this. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpServerConfig {
  /** The server's single Streamable-HTTP endpoint. */
  url: string
  /** Static request headers — typically `{ Authorization: 'Bearer …' }`.
   *  Held in memory only; never persisted by this module. */
  headers?: Record<string, string>
  protocolVersion?: string
  clientInfo?: { name: string; version: string }
  /** Injectable for tests / custom egress policies (SSRF pinning). */
  fetchImpl?: typeof fetch
}

export interface McpToolCallResult {
  /** MCP content blocks (text, image, resource, …) verbatim. */
  content: unknown[]
  isError: boolean
  /** `structuredContent` from servers that return it. */
  structured?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Minimal Streamable-HTTP MCP client: `initialize` handshake (capturing the
 * server's `Mcp-Session-Id`), paginated `tools/list`, and `tools/call`.
 * Lazily initializes on first use; safe to share across calls within an
 * isolate.
 */
export class McpHttpClient {
  private nextId = 1
  private sessionId: string | undefined
  private negotiatedVersion: string | undefined
  private initializing: Promise<void> | undefined

  constructor(private readonly config: McpServerConfig) {}

  private get fetchImpl(): typeof fetch {
    return this.config.fetchImpl ?? fetch
  }

  private async post(body: Record<string, unknown>): Promise<JsonRpcResponse | undefined> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
    }
    const version = this.negotiatedVersion ?? this.config.protocolVersion ?? MCP_PROTOCOL_VERSION
    headers['MCP-Protocol-Version'] = version
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId

    let response: Response
    try {
      response = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new IntegrationError(
        `MCP server unreachable: ${error instanceof Error ? error.message : String(error)}`,
        'provider_failure',
      )
    }
    const session = response.headers.get('mcp-session-id')
    if (session) this.sessionId = session

    if (!response.ok) {
      throw new IntegrationError(`MCP server returned HTTP ${response.status}`, 'provider_failure')
    }
    // Notifications get 202/204 with no body.
    if (body.id === undefined) return undefined
    const contentType = response.headers.get('content-type') ?? ''
    const text = await response.text()
    const message = contentType.includes('text/event-stream')
      ? findSseResponse(text, body.id as number)
      : (JSON.parse(text) as JsonRpcResponse)
    if (!message) {
      throw new IntegrationError('MCP server response missing a result for the request', 'provider_failure')
    }
    if (message.error) {
      throw new IntegrationError(`MCP error ${message.error.code}: ${message.error.message}`, 'provider_failure')
    }
    return message
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, ...(params ? { params } : {}) })
    return response?.result
  }

  /** Idempotent handshake; concurrent callers share one in-flight init. */
  async initialize(): Promise<void> {
    if (this.negotiatedVersion) return
    this.initializing ??= (async () => {
      const result = (await this.request('initialize', {
        protocolVersion: this.config.protocolVersion ?? MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: this.config.clientInfo ?? { name: 'tangle-agent-integrations', version: '1' },
      })) as { protocolVersion?: string } | undefined
      this.negotiatedVersion = result?.protocolVersion ?? this.config.protocolVersion ?? MCP_PROTOCOL_VERSION
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })().catch((error) => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }

  /** Full tool catalog, following `nextCursor` pagination. */
  async listTools(): Promise<McpCatalogTool[]> {
    await this.initialize()
    const tools: McpCatalogTool[] = []
    let cursor: string | undefined
    do {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as
        | { tools?: McpCatalogTool[]; nextCursor?: string }
        | undefined
      tools.push(...(result?.tools ?? []))
      cursor = result?.nextCursor
    } while (cursor)
    return tools
  }

  async callTool(name: string, args: unknown): Promise<McpToolCallResult> {
    await this.initialize()
    const result = (await this.request('tools/call', { name, arguments: args ?? {} })) as
      | { content?: unknown[]; isError?: boolean; structuredContent?: unknown }
      | undefined
    return {
      content: result?.content ?? [],
      isError: result?.isError === true,
      structured: result?.structuredContent,
    }
  }
}

export interface CreateMcpProviderOptions {
  /** Provider id, unique within the hub (e.g. `mcp:linear`). */
  id: string
  server: McpServerConfig
  connectorId: string
  connectorTitle: string
  category?: IntegrationConnectorCategory
  scopes?: string[]
  dataClass?: IntegrationDataClass
  /** Risk for tools whose annotations/name don't classify them. Defaults to
   *  'write' (⇒ approvalRequired) — fail-closed. */
  defaultRisk?: IntegrationActionRisk
}

/** Discover a live MCP server's tools as an {@link IntegrationConnector}. */
export async function discoverMcpConnector(
  client: McpHttpClient,
  options: CreateMcpProviderOptions,
): Promise<IntegrationConnector> {
  const tools = await client.listTools()
  return importMcpConnector(
    { tools },
    {
      providerId: options.id,
      connectorId: options.connectorId,
      connectorTitle: options.connectorTitle,
      category: options.category,
      auth: 'custom',
      scopes: options.scopes,
      dataClass: options.dataClass,
      defaultRisk: options.defaultRisk ?? 'write',
    },
  )
}

/**
 * Build an {@link IntegrationProvider} over one remote MCP server: live
 * `tools/list` discovery at construction, `tools/call` on invoke. A tool
 * result with `isError` maps to `{ ok: false }` (the model sees the failure
 * content); transport and JSON-RPC failures throw {@link IntegrationError}.
 */
export async function createMcpProvider(options: CreateMcpProviderOptions): Promise<IntegrationProvider> {
  const client = new McpHttpClient(options.server)
  const connector = await discoverMcpConnector(client, options)
  return createCatalogExecutorProvider({
    id: options.id,
    kind: 'mcp',
    connectors: [connector],
    async executeAction({ request, action }): Promise<IntegrationActionResult> {
      const result = await client.callTool(action.id, request.input)
      return {
        ok: !result.isError,
        action: action.id,
        output: result.structured ?? result.content,
        metadata: { mcp: true, ...(result.isError ? { isError: true } : {}) },
      }
    },
  })
}

function findSseResponse(body: string, id: number): JsonRpcResponse | undefined {
  for (const event of body.split(/\n\n/)) {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
    if (!data) continue
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse
      if (parsed.id === id) return parsed
    } catch {
      // non-JSON SSE frame (keepalive/comment) — skip
    }
  }
  return undefined
}
