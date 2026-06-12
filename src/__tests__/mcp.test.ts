import { describe, expect, it } from 'vitest'
import { IntegrationError } from '../core-error.js'
import { createMcpProvider, McpHttpClient } from '../mcp.js'

interface RecordedCall {
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/** Fake Streamable-HTTP MCP server with two tools, session ids, and
 *  two-page tools/list pagination. */
function fakeServer(opts: { sse?: boolean; failCall?: boolean } = {}) {
  const calls: RecordedCall[] = []
  const tools = [
    {
      name: 'search_issues',
      description: 'Search issues',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'delete_issue',
      description: 'Delete an issue',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
    },
  ]

  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ method: body.method as string, headers: { ...(init?.headers as Record<string, string>) }, body })

    const respond = (result: unknown) => {
      const message = { jsonrpc: '2.0', id: body.id, result }
      if (opts.sse) {
        return new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
          headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' },
        })
      }
      return new Response(JSON.stringify(message), {
        headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
      })
    }

    switch (body.method) {
      case 'initialize':
        return respond({ protocolVersion: '2025-06-18', serverInfo: { name: 'fake', version: '1' } })
      case 'notifications/initialized':
        return new Response(null, { status: 202 })
      case 'tools/list': {
        const cursor = (body.params as { cursor?: string } | undefined)?.cursor
        return respond(cursor ? { tools: [tools[1]] } : { tools: [tools[0]], nextCursor: 'page2' })
      }
      case 'tools/call':
        if (opts.failCall) {
          return respond({ content: [{ type: 'text', text: 'boom' }], isError: true })
        }
        return respond({ content: [{ type: 'text', text: 'ok' }], structuredContent: { hits: 2 } })
      default:
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'nope' } }), {
          headers: { 'content-type': 'application/json' },
        })
    }
  }

  return { fetchImpl, calls }
}

describe('McpHttpClient', () => {
  it('initializes once, captures the session id, and paginates tools/list', async () => {
    const server = fakeServer()
    const client = new McpHttpClient({
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer tok' },
      fetchImpl: server.fetchImpl,
    })
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['search_issues', 'delete_issue'])

    const methods = server.calls.map((c) => c.method)
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list'])
    // Session id from initialize rides on every subsequent request.
    expect(server.calls[2].headers['Mcp-Session-Id']).toBe('sess-1')
    expect(server.calls[2].headers.Authorization).toBe('Bearer tok')

    // Second use does not re-initialize.
    await client.callTool('search_issues', { query: 'x' })
    expect(server.calls.filter((c) => c.method === 'initialize')).toHaveLength(1)
  })

  it('parses SSE-framed responses', async () => {
    const server = fakeServer({ sse: true })
    const client = new McpHttpClient({ url: 'https://mcp.example.com/mcp', fetchImpl: server.fetchImpl })
    const tools = await client.listTools()
    expect(tools).toHaveLength(2)
  })

  it('maps JSON-RPC errors to IntegrationError(provider_failure)', async () => {
    const server = fakeServer()
    const client = new McpHttpClient({ url: 'https://mcp.example.com/mcp', fetchImpl: server.fetchImpl })
    await client.initialize()
    await expect(
      (client as unknown as { request(m: string): Promise<unknown> }).request('bogus/method'),
    ).rejects.toThrowError(IntegrationError)
  })
})

describe('createMcpProvider', () => {
  it('discovers tools as a connector with annotation-derived risk + approvals', async () => {
    const server = fakeServer()
    const provider = await createMcpProvider({
      id: 'mcp:fake',
      server: { url: 'https://mcp.example.com/mcp', fetchImpl: server.fetchImpl },
      connectorId: 'fake',
      connectorTitle: 'Fake Tracker',
    })
    expect(provider.kind).toBe('mcp')
    const connectors = await provider.listConnectors()
    expect(connectors).toHaveLength(1)
    const byId = new Map(connectors[0].actions.map((a) => [a.id, a]))
    expect(byId.get('search_issues')?.risk).toBe('read')
    expect(byId.get('search_issues')?.approvalRequired).toBe(false)
    expect(byId.get('delete_issue')?.risk).toBe('destructive')
    expect(byId.get('delete_issue')?.approvalRequired).toBe(true)
  })

  it('invokes tools/call and surfaces structured output', async () => {
    const server = fakeServer()
    const provider = await createMcpProvider({
      id: 'mcp:fake',
      server: { url: 'https://mcp.example.com/mcp', fetchImpl: server.fetchImpl },
      connectorId: 'fake',
      connectorTitle: 'Fake Tracker',
    })
    const result = await provider.invokeAction(
      connection('mcp:fake', 'fake'),
      { connectionId: 'c1', action: 'search_issues', input: { query: 'x' } },
    )
    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ hits: 2 })
  })

  it('maps isError tool results to ok:false without throwing', async () => {
    const server = fakeServer({ failCall: true })
    const provider = await createMcpProvider({
      id: 'mcp:fake',
      server: { url: 'https://mcp.example.com/mcp', fetchImpl: server.fetchImpl },
      connectorId: 'fake',
      connectorTitle: 'Fake Tracker',
    })
    const result = await provider.invokeAction(
      connection('mcp:fake', 'fake'),
      { connectionId: 'c1', action: 'search_issues', input: {} },
    )
    expect(result.ok).toBe(false)
    expect(result.metadata).toMatchObject({ mcp: true, isError: true })
  })
})

function connection(providerId: string, connectorId: string) {
  return {
    id: 'c1',
    owner: { type: 'user' as const, id: 'u1' },
    providerId,
    connectorId,
    status: 'active' as const,
    grantedScopes: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}
