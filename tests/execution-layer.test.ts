import { describe, expect, it } from 'vitest'
import {
  InMemoryConnectionStore,
  IntegrationError,
  IntegrationHub,
  buildIntegrationInvocationEnvelope,
  buildIntegrationToolCatalog,
  createConnectorAdapterProvider,
  createDefaultIntegrationPolicyEngine,
  invocationRequestFromEnvelope,
  normalizeIntegrationResult,
  parseIntegrationToolName,
  searchIntegrationTools,
  toMcpTools,
  type ConnectorAdapter,
  type ResolvedDataSource,
} from '../src/index'

const owner = { type: 'user' as const, id: 'user_1' }

const notesAdapter: ConnectorAdapter = {
  manifest: {
    kind: 'notes',
    displayName: 'Notes',
    description: 'Read and write project notes.',
    auth: { kind: 'none' },
    category: 'doc',
    defaultConsistencyModel: 'authoritative',
    capabilities: [
      {
        name: 'notes.search',
        class: 'read',
        description: 'Search notes.',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
      {
        name: 'notes.create',
        class: 'mutation',
        description: 'Create a note.',
        parameters: { type: 'object', properties: { title: { type: 'string' } } },
        cas: 'native-idempotency',
        externalEffect: false,
      },
    ],
  },
  async executeRead(invocation) {
    return {
      data: { query: invocation.args.q, items: [{ id: 'note_1', title: 'Launch' }] },
      fetchedAt: 1,
      etag: 'etag_1',
    }
  },
  async executeMutation(invocation) {
    return {
      status: 'committed',
      data: { id: 'note_2', title: invocation.args.title },
      committedAt: 2,
      idempotentReplay: false,
    }
  },
  async test() {
    return { ok: true }
  },
}

function sourceFor(connectionId: string): ResolvedDataSource {
  return {
    id: connectionId,
    projectId: 'project_1',
    publishedAgentId: 'agent_1',
    kind: 'notes',
    label: 'Project notes',
    consistencyModel: 'authoritative',
    scopes: [],
    metadata: {},
    credentials: { kind: 'none' },
    status: 'active',
  }
}

describe('execution layer', () => {
  it('builds a searchable MCP-compatible tool catalog', () => {
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const catalog = buildIntegrationToolCatalog(provider.listConnectors() as ReturnType<typeof provider.listConnectors> extends Promise<infer T> ? T : never)

    const results = searchIntegrationTools(catalog, 'find project notes', { maxRisk: 'read' })
    const mcpTools = toMcpTools(results.map((result) => result.tool))
    const parsed = parseIntegrationToolName(results[0].tool.name)

    expect(results[0].tool.action.id).toBe('notes.search')
    expect(parsed).toEqual({ providerId: 'first-party', connectorId: 'notes', actionId: 'notes.search' })
    expect(mcpTools[0]).toMatchObject({ name: results[0].tool.name })
  })

  it('routes first-party adapter reads through IntegrationHub capabilities', async () => {
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store,
      capabilitySecret: 'secret',
    })
    await hub.upsertConnection({
      id: 'conn_notes',
      owner,
      providerId: 'first-party',
      connectorId: 'notes',
      status: 'active',
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const issued = await hub.issueCapability({
      subject: { type: 'sandbox', id: 'sandbox_1' },
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.search'],
      ttlMs: 60_000,
    })

    const result = await hub.invokeWithCapability(issued.token, {
      action: 'notes.search',
      input: { q: 'launch' },
    })

    expect(result).toMatchObject({
      ok: true,
      action: 'notes.search',
      output: { query: 'launch' },
      metadata: { etag: 'etag_1', fetchedAt: 1 },
    })
  })

  it('pauses writes through the default policy and returns an approval artifact', async () => {
    const store = new InMemoryConnectionStore()
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const hub = new IntegrationHub({
      providers: [provider],
      store,
      capabilitySecret: 'secret',
      policy: createDefaultIntegrationPolicyEngine({
        now: () => new Date('2026-05-04T00:00:00.000Z'),
      }),
    })
    await hub.upsertConnection({
      id: 'conn_notes',
      owner,
      providerId: 'first-party',
      connectorId: 'notes',
      status: 'active',
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const issued = await hub.issueCapability({
      subject: { type: 'agent', id: 'agent_1' },
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.create'],
      ttlMs: 60_000,
    })

    const result = await hub.invokeWithCapability(issued.token, {
      action: 'notes.create',
      input: { title: 'Launch plan', apiKey: 'secret' },
      idempotencyKey: 'create-1',
    })
    const normalized = normalizeIntegrationResult(result)

    expect(normalized.status).toBe('approval_required')
    if (normalized.status !== 'approval_required') throw new Error('expected approval')
    expect(normalized.approval).toMatchObject({
      connectionId: 'conn_notes',
      providerId: 'first-party',
      connectorId: 'notes',
      action: 'notes.create',
      risk: 'write',
      requestedAt: '2026-05-04T00:00:00.000Z',
    })
    expect(JSON.stringify(normalized.approval.inputPreview)).not.toContain('secret')
  })

  it('builds sandbox invocation envelopes from catalog tool names', () => {
    const provider = createConnectorAdapterProvider({
      adapters: [notesAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const catalog = buildIntegrationToolCatalog(provider.listConnectors() as ReturnType<typeof provider.listConnectors> extends Promise<infer T> ? T : never)
    const tool = catalog.find((candidate) => candidate.action.id === 'notes.search')
    if (!tool) throw new Error('missing notes.search')

    const envelope = buildIntegrationInvocationEnvelope({
      capabilityToken: 'capability.token',
      toolName: tool.name,
      args: { q: 'launch' },
      idempotencyKey: 'search-1',
    })
    const request = invocationRequestFromEnvelope(envelope)

    expect(envelope).toMatchObject({
      kind: 'integration.invocation',
      action: 'notes.search',
      idempotencyKey: 'search-1',
    })
    expect(request).toEqual({
      action: 'notes.search',
      input: { q: 'launch' },
      idempotencyKey: 'search-1',
      dryRun: undefined,
      metadata: undefined,
    })
  })

  it('denies destructive actions by default policy', async () => {
    const destructiveAdapter: ConnectorAdapter = {
      ...notesAdapter,
      manifest: {
        ...notesAdapter.manifest,
        capabilities: [{
          name: 'notes.delete',
          class: 'mutation',
          description: 'Delete a note.',
          parameters: {},
          cas: 'native-idempotency',
          externalEffect: true,
        }],
      },
    }
    const provider = createConnectorAdapterProvider({
      adapters: [destructiveAdapter],
      resolveDataSource: (connection) => sourceFor(connection.id),
    })
    const store = new InMemoryConnectionStore()
    const hub = new IntegrationHub({
      providers: [provider],
      store,
      capabilitySecret: 'secret',
      policy: createDefaultIntegrationPolicyEngine(),
    })
    await hub.upsertConnection({
      id: 'conn_notes',
      owner,
      providerId: 'first-party',
      connectorId: 'notes',
      status: 'active',
      grantedScopes: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    })
    const issued = await hub.issueCapability({
      subject: { type: 'agent', id: 'agent_1' },
      connectionId: 'conn_notes',
      scopes: [],
      allowedActions: ['notes.delete'],
      ttlMs: 60_000,
    })

    await expect(hub.invokeWithCapability(issued.token, {
      action: 'notes.delete',
      idempotencyKey: 'delete-1',
    })).rejects.toMatchObject({ code: 'policy_denied' } satisfies Partial<IntegrationError>)
  })
})
